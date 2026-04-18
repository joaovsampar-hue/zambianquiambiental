// Exporta o mapa do processo em PDF A4 paisagem com layout cartográfico clássico.
//
// Estratégia (v3 — correções de distorção):
// - Captura o basemap (satélite/ruas) via html-to-image, ESCONDENDO as camadas
//   WMS SIGEF/SICAR antes da captura (com 2x rAF + delay para garantir reflow).
// - Por cima da imagem do basemap, desenha os polígonos vetorialmente direto no
//   jsPDF — projetando lat/lng → pixel via Leaflet `latLngToContainerPoint`.
// - **Recorta** polígonos vizinhos ao bounds do mapa visível antes de desenhar
//   (evita "faixas diagonais" de polígonos que se estendem fora do viewport).
// - Usa `pdf.text(..., {align: 'center'})` nativo (sem getTextWidth manual) →
//   sem letter-spacing fantasma quando a fonte cai pra helvetica.
// - Painel lateral idêntico ao modelo Zambianqui: logo, título, datum, escala
//   gráfica, legenda, assinatura.

import jsPDF from 'jspdf';
import L from 'leaflet';
import { embedInterFont } from './pdfFonts';

// ===== Captura do basemap em canvas próprio =====
// html-to-image falha quando algum tile não devolve cabeçalho CORS, taintando
// o canvas. Em vez disso, percorremos os L.TileLayer ativos e baixamos cada
// tile via fetch (com fallback para <img> sem CORS quando o servidor não
// libera). O resultado é um PNG sempre válido.

interface BasemapCaptureResult {
  dataUrl: string | null;
  width: number;  // largura em CSS px do container DOM
  height: number; // altura em CSS px do container DOM
}

async function loadImageWithFallback(url: string): Promise<HTMLImageElement | null> {
  // Tenta com crossOrigin primeiro (necessário para drawImage sem taint).
  const tryLoad = (crossOrigin: string | null) =>
    new Promise<HTMLImageElement | null>(resolve => {
      const img = new Image();
      if (crossOrigin) img.crossOrigin = crossOrigin;
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  let img = await tryLoad('anonymous');
  if (img) return img;
  // Fallback sem CORS — vai funcionar mas o canvas fica tainted.
  img = await tryLoad(null);
  return img;
}

// Constrói uma URL WMS GetMap para uma sub-região (em pixel-mundo) na projeção
// EPSG:3857 (Web Mercator) — mesma usada pelo Leaflet por padrão.
function buildWmsTileUrl(
  layer: L.TileLayer.WMS,
  map: L.Map,
  worldX: number, worldY: number, sizePx: number,
): string {
  const zoom = map.getZoom();
  // Converte pixel-mundo → latlng → web-mercator metros.
  const nw = map.unproject([worldX, worldY], zoom);
  const se = map.unproject([worldX + sizePx, worldY + sizePx], zoom);
  // EPSG:3857 metros (Leaflet expõe via L.CRS.EPSG3857.project)
  const pNw = L.CRS.EPSG3857.project(nw);
  const pSe = L.CRS.EPSG3857.project(se);
  const minX = Math.min(pNw.x, pSe.x);
  const maxX = Math.max(pNw.x, pSe.x);
  const minY = Math.min(pNw.y, pSe.y);
  const maxY = Math.max(pNw.y, pSe.y);
  const opts = (layer as any).wmsParams as Record<string, any>;
  const baseUrl = (layer as any)._url as string;
  const params: Record<string, string> = {
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: opts.version ?? '1.1.1',
    LAYERS: opts.layers ?? '',
    STYLES: opts.styles ?? '',
    FORMAT: opts.format ?? 'image/png',
    TRANSPARENT: String(opts.transparent ?? true),
    SRS: 'EPSG:3857',
    CRS: 'EPSG:3857',
    BBOX: `${minX},${minY},${maxX},${maxY}`,
    WIDTH: String(sizePx),
    HEIGHT: String(sizePx),
  };
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${qs}`;
}

async function captureBasemap(map: L.Map, container: HTMLElement): Promise<BasemapCaptureResult> {
  const rect = container.getBoundingClientRect();
  const W = Math.round(rect.width);
  const H = Math.round(rect.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const canvas = document.createElement('canvas');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { dataUrl: null, width: W, height: H };
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(0, 0, W, H);

  const zoom = map.getZoom();
  const tileSize = 256;
  // Origem em pixel-mundo do canto superior-esquerdo do container DOM. Usar
  // map.project(unproject([0,0])) garante que o offset corresponde EXATAMENTE
  // ao que latLngToContainerPoint usa quando projetamos os polígonos depois.
  const nwLatLng = map.containerPointToLatLng([0, 0]);
  const seLatLng = map.containerPointToLatLng([W, H]);
  const nwPx = map.project(nwLatLng, zoom);
  const sePx = map.project(seLatLng, zoom);
  const originX = nwPx.x;
  const originY = nwPx.y;
  const tMinX = Math.floor(nwPx.x / tileSize);
  const tMinY = Math.floor(nwPx.y / tileSize);
  const tMaxX = Math.floor(sePx.x / tileSize);
  const tMaxY = Math.floor(sePx.y / tileSize);

  // Coleta camadas: basemap (TileLayer não-WMS) + overlays WMS (SIGEF/SICAR).
  const baseLayers: L.TileLayer[] = [];
  const wmsLayers: L.TileLayer.WMS[] = [];
  map.eachLayer(layer => {
    if (layer instanceof L.TileLayer.WMS) {
      wmsLayers.push(layer);
    } else if (layer instanceof L.TileLayer) {
      baseLayers.push(layer);
    }
  });

  const drawTile = (img: HTMLImageElement, x: number, y: number) => {
    const px = x * tileSize - originX;
    const py = y * tileSize - originY;
    try { ctx.drawImage(img, px, py, tileSize, tileSize); } catch { /* tainted */ }
  };

  // 1) Basemap (XYZ tiles).
  for (const layer of baseLayers) {
    const getTileUrl: ((coords: any) => string) | undefined = (layer as any).getTileUrl?.bind(layer);
    if (!getTileUrl) continue;
    const promises: Promise<{ img: HTMLImageElement | null; x: number; y: number }>[] = [];
    for (let x = tMinX; x <= tMaxX; x++) {
      for (let y = tMinY; y <= tMaxY; y++) {
        const url = getTileUrl({ x, y, z: zoom });
        promises.push(loadImageWithFallback(url).then(img => ({ img, x, y })));
      }
    }
    const tiles = await Promise.all(promises);
    for (const { img, x, y } of tiles) if (img) drawTile(img, x, y);
  }

  // 2) WMS overlays (SIGEF / SICAR) — mesmo grid de tiles, usando GetMap por bbox.
  for (const layer of wmsLayers) {
    const promises: Promise<{ img: HTMLImageElement | null; x: number; y: number }>[] = [];
    for (let x = tMinX; x <= tMaxX; x++) {
      for (let y = tMinY; y <= tMaxY; y++) {
        const url = buildWmsTileUrl(layer, map, x * tileSize, y * tileSize, tileSize);
        promises.push(loadImageWithFallback(url).then(img => ({ img, x, y })));
      }
    }
    const tiles = await Promise.all(promises);
    for (const { img, x, y } of tiles) if (img) drawTile(img, x, y);
  }

  try {
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.9), width: W, height: H };
  } catch (err) {
    console.warn('[captureBasemap] canvas tainted, returning null', err);
    return { dataUrl: null, width: W, height: H };
  }
}

export interface ExportMapOptions {
  mapContainer: HTMLElement;
  leafletMap: L.Map;
  mainFeature: GeoJSON.Feature | null;
  neighborsFc: GeoJSON.FeatureCollection | null;
  setOverlayTilesVisible?: (visible: boolean) => void;
  title: string;
  clientName?: string;
  responsibleName?: string;
  responsibleRole?: string;
  responsibleRegistry?: string;
  responsibleSignatureUrl?: string;
  producedBy?: string;
  companyName?: string;
  companyTagline?: string;
  companyLogoUrl?: string;
  fileName?: string;
  areaHa?: number;
}

// ===== Cálculos cartográficos =====

function estimateMapScale(map: L.Map): number {
  const center = map.getCenter();
  const zoom = map.getZoom();
  const R = 6378137;
  const metersPerPixel = (Math.cos((center.lat * Math.PI) / 180) * 2 * Math.PI * R) / (256 * Math.pow(2, zoom));
  const scale = metersPerPixel * 96 / 0.0254;
  const niceScales = [500, 1000, 2000, 2500, 5000, 7500, 10000, 12000, 15000, 25000, 50000, 100000, 250000];
  return niceScales.reduce((prev, curr) => Math.abs(curr - scale) < Math.abs(prev - scale) ? curr : prev, niceScales[0]);
}

function utmZoneFromLng(lng: number): number {
  return Math.floor((lng + 180) / 6) + 1;
}

async function urlToDataUrl(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise((res, rej) => {
      const r = new FileReader();
      r.onloadend = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// Recorta um dataURL PNG para uma sub-região (em px do DOM) — preserva o
// aspect ratio do slot do PDF sem distorcer. `pixelRatio` precisa bater com o
// usado em toPng() (estamos usando 2).
async function cropPngToAspect(
  pngDataUrl: string,
  srcXdom: number, srcYdom: number, srcWdom: number, srcHdom: number,
  pixelRatio: number,
): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = pngDataUrl;
  });
  const sx = Math.round(srcXdom * pixelRatio);
  const sy = Math.round(srcYdom * pixelRatio);
  const sw = Math.round(srcWdom * pixelRatio);
  const sh = Math.round(srcHdom * pixelRatio);
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return pngDataUrl;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL('image/png');
}

// ===== Projeção lat/lng → coordenadas no PDF =====
// Como o PNG do basemap é RECORTADO para o aspect ratio do slot do PDF (sem
// distorcer), o projetor precisa usar o MESMO recorte: pega o ponto na imagem
// original, subtrai o offset do crop, e escala pela razão do crop visível.
function makeProjector(
  map: L.Map,
  mapDom: HTMLElement,
  pdfX: number, pdfY: number, pdfW: number, pdfH: number,
  crop: { srcX: number; srcY: number; srcW: number; srcH: number; domW: number; domH: number },
) {
  // domW/domH = dimensões do container DOM real (em CSS px)
  // srcX/srcY/srcW/srcH = sub-região (em CSS px do DOM) que vira o conteúdo do PDF
  const scaleX = pdfW / crop.srcW;
  const scaleY = pdfH / crop.srcH;
  return (lat: number, lng: number): [number, number] => {
    const p = map.latLngToContainerPoint([lat, lng]);
    return [pdfX + (p.x - crop.srcX) * scaleX, pdfY + (p.y - crop.srcY) * scaleY];
  };
}

type Projector = ReturnType<typeof makeProjector>;

// ===== Recorte de feições ao viewport =====
// Em vez de cortar geometrias com turf (que falhava em multipolígonos grandes),
// usamos o clipping path nativo do PDF: tudo desenhado fora do retângulo do
// mapa simplesmente não aparece. Mais rápido, exato e elimina o bug das
// "faixas diagonais".
function withMapClip(pdf: jsPDF, x: number, y: number, w: number, h: number, draw: () => void) {
  const anyPdf = pdf as any;
  if (typeof anyPdf.saveGraphicsState === 'function') anyPdf.saveGraphicsState();
  pdf.rect(x, y, w, h);
  if (typeof anyPdf.clip === 'function') anyPdf.clip();
  if (typeof anyPdf.discardPath === 'function') anyPdf.discardPath();
  try {
    draw();
  } finally {
    if (typeof anyPdf.restoreGraphicsState === 'function') anyPdf.restoreGraphicsState();
  }
}

// Desenha um ring fechado num único path do PDF — fill+stroke em um pass
// (modo 'B'), garantindo que o último ponto retorne ao primeiro para evitar
// "faixas" residuais de path aberto.
function drawClosedRing(
  pdf: jsPDF,
  pts: Array<[number, number]>,
  style: 'F' | 'S' | 'B',
) {
  if (pts.length < 3) return;
  const closed = [...pts];
  const first = closed[0];
  const last = closed[closed.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) closed.push([first[0], first[1]]);
  const deltas: [number, number][] = [];
  for (let i = 1; i < closed.length; i++) {
    deltas.push([closed[i][0] - closed[i - 1][0], closed[i][1] - closed[i - 1][1]]);
  }
  pdf.lines(deltas, closed[0][0], closed[0][1], [1, 1], style, true);
}

function drawGeoFeature(
  pdf: jsPDF,
  feature: GeoJSON.Feature,
  proj: Projector,
  style: {
    stroke: [number, number, number];
    strokeWidth: number;
    fill?: [number, number, number] | null;
    fillOpacity?: number;
  },
) {
  const geom = feature.geometry;
  if (!geom) return;

  pdf.setDrawColor(style.stroke[0], style.stroke[1], style.stroke[2]);
  pdf.setLineWidth(style.strokeWidth);
  if (style.fill) pdf.setFillColor(style.fill[0], style.fill[1], style.fill[2]);

  const drawMode: 'F' | 'S' | 'B' = style.fill ? 'B' : 'S';

  // Aplica opacidade via GState se disponível.
  const anyPdf = pdf as any;
  const hasGState = typeof anyPdf.GState === 'function' && typeof anyPdf.setGState === 'function';
  if (hasGState && style.fill && style.fillOpacity != null) {
    anyPdf.setGState(new anyPdf.GState({ opacity: style.fillOpacity, 'stroke-opacity': 1 }));
  }

  const renderRing = (ring: number[][]) => {
    if (!ring || ring.length < 4) return;
    const pts = ring.map(([lng, lat]) => proj(lat, lng));
    drawClosedRing(pdf, pts, drawMode);
  };

  if (geom.type === 'Polygon') {
    geom.coordinates.forEach(renderRing);
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates.forEach(poly => poly.forEach(renderRing));
  }

  if (hasGState) {
    anyPdf.setGState(new anyPdf.GState({ opacity: 1, 'stroke-opacity': 1 }));
  }
}

// ===== Função principal =====

export async function exportProcessMap(opts: ExportMapOptions): Promise<void> {
  const {
    mapContainer, leafletMap, mainFeature, neighborsFc, setOverlayTilesVisible,
    title, responsibleName, responsibleRole, responsibleRegistry, responsibleSignatureUrl,
    producedBy, companyName = 'GeoConfront', companyTagline = 'Análise de Confrontantes',
    companyLogoUrl, fileName = 'mapa-processo', areaHa,
  } = opts;

  console.log('[exportProcessMap] start', {
    hasMain: !!mainFeature,
    neighborsCount: neighborsFc?.features?.length ?? 0,
    title,
  });

  const leafletEl = (mapContainer.querySelector('.leaflet-container') as HTMLElement) ?? mapContainer;
  console.log('[exportProcessMap] leafletEl size', leafletEl.getBoundingClientRect());

  const controlsToHide = leafletEl.querySelectorAll<HTMLElement>(
    '.leaflet-control-zoom, .leaflet-control-layers, .leaflet-control-attribution',
  );
  const prevDisplays = Array.from(controlsToHide).map(el => el.style.display);
  controlsToHide.forEach(el => { el.style.display = 'none'; });
  setOverlayTilesVisible?.(false);

  // Centraliza no imóvel principal antes de capturar (foco no cliente).
  let prevView: { center: L.LatLng; zoom: number } | null = null;
  if (mainFeature?.geometry) {
    try {
      prevView = { center: leafletMap.getCenter(), zoom: leafletMap.getZoom() };
      const tmpLayer = L.geoJSON(mainFeature as any);
      const b = tmpLayer.getBounds();
      if (b.isValid()) {
        leafletMap.fitBounds(b, { padding: [40, 40], animate: false });
      }
    } catch (err) {
      console.warn('[exportProcessMap] fitBounds falhou:', err);
    }
  }

  await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  await new Promise(r => setTimeout(r, 350));

  let basemap: BasemapCaptureResult = { dataUrl: null, width: leafletEl.clientWidth, height: leafletEl.clientHeight };
  try {
    console.log('[exportProcessMap] capturing basemap via canvas...');
    basemap = await captureBasemap(leafletMap, leafletEl);
    console.log('[exportProcessMap] basemap captured:', { hasData: !!basemap.dataUrl, w: basemap.width, h: basemap.height });
  } catch (err) {
    console.error('[exportProcessMap] captureBasemap failed:', err);
  } finally {
    controlsToHide.forEach((el, i) => { el.style.display = prevDisplays[i]; });
    setOverlayTilesVisible?.(true);
    if (prevView) {
      try { leafletMap.setView(prevView.center, prevView.zoom, { animate: false }); } catch { /* ignore */ }
    }
  }

  // ===== PDF A4 paisagem =====
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const hasInter = await embedInterFont(pdf);
  const FAM = hasInter ? 'Inter' : 'helvetica';
  const PAGE_W = 297, PAGE_H = 210;
  const MARGIN = 6;
  const PANEL_W = 72;
  const GAP = 2;
  const MAP_W = PAGE_W - MARGIN * 2 - PANEL_W - GAP;
  const MAP_H = PAGE_H - MARGIN * 2;

  // Helper: usa o align nativo do jsPDF (sem getTextWidth manual → sem
  // letter-spacing fantasma quando o fallback helvetica é usado).
  const centerText = (text: string, x: number, y: number) => {
    pdf.text(text, x, y, { align: 'center' });
  };

  // Borda externa
  pdf.setDrawColor(0, 0, 0).setLineWidth(0.4);
  pdf.rect(MARGIN, MARGIN, PAGE_W - MARGIN * 2, PAGE_H - MARGIN * 2);

  // ===== Mapa (esquerda) — basemap + polígonos vetoriais =====
  // O basemap foi capturado nas dimensões EXATAS do container DOM. Para encaixar
  // no slot do PDF sem distorcer, calculamos o crop "cover" (corta sobras) — mas
  // como o basemap é renderizado nas mesmas dimensões do mapa visível, basta
  // ajustar o aspect ratio cortando as bordas se necessário.
  const domW = basemap.width;
  const domH = basemap.height;
  const targetAspect = MAP_W / MAP_H;
  const sourceAspect = domW / domH;
  let cropSrcX = 0, cropSrcY = 0, cropSrcW = domW, cropSrcH = domH;
  if (sourceAspect > targetAspect) {
    cropSrcW = domH * targetAspect;
    cropSrcX = (domW - cropSrcW) / 2;
  } else {
    cropSrcH = domW / targetAspect;
    cropSrcY = (domH - cropSrcH) / 2;
  }

  if (basemap.dataUrl) {
    let imgToAdd = basemap.dataUrl;
    try {
      imgToAdd = await cropPngToAspect(basemap.dataUrl, cropSrcX, cropSrcY, cropSrcW, cropSrcH, 1);
    } catch (err) {
      console.error('[exportProcessMap] crop failed, using original:', err);
    }
    try {
      pdf.addImage(imgToAdd, 'JPEG', MARGIN, MARGIN, MAP_W, MAP_H, undefined, 'FAST');
    } catch (err) {
      console.error('[exportProcessMap] addImage failed:', err);
    }
  } else {
    console.warn('[exportProcessMap] basemap unavailable, rendering vector-only map');
    pdf.setFillColor(245, 245, 245);
    pdf.rect(MARGIN, MARGIN, MAP_W, MAP_H, 'F');
  }

  const cropMeta = {
    srcX: cropSrcX, srcY: cropSrcY, srcW: cropSrcW, srcH: cropSrcH,
    domW, domH,
  };

  // Desenha APENAS o imóvel do cliente (verde). Os vizinhos vivem na listagem,
  // não no mapa — basta o usuário ver onde fica o imóvel e os polígonos
  // certificados (SIGEF) que o basemap WMS já mostra.
  withMapClip(pdf, MARGIN, MARGIN, MAP_W, MAP_H, () => {
    const proj = makeProjector(leafletMap, leafletEl, MARGIN, MARGIN, MAP_W, MAP_H, cropMeta);
    if (mainFeature) {
      drawGeoFeature(pdf, mainFeature, proj, {
        stroke: [40, 130, 60],
        strokeWidth: 1.0,
        fill: [120, 200, 130],
        fillOpacity: 0.22,
      });
    }
  });

  // Borda do mapa
  pdf.setDrawColor(0, 0, 0).setLineWidth(0.4);
  pdf.rect(MARGIN, MARGIN, MAP_W, MAP_H);

  // Área do imóvel (canto inferior esquerdo) — info útil mesmo sem escala.
  if (areaHa != null) {
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(180, 180, 180);
    pdf.setFont(FAM, 'normal').setFontSize(10).setTextColor(0, 0, 0);
    const txt = `Área: ${areaHa.toFixed(3)} ha`;
    const w = pdf.getTextWidth(txt) + 4;
    pdf.rect(MARGIN + 3, MARGIN + MAP_H - 9, w, 6, 'FD');
    pdf.text(txt, MARGIN + 5, MARGIN + MAP_H - 4.5);
  }

  drawNorthArrow(pdf, MARGIN + 6, MARGIN + 6, 10, FAM);

  // ===== Painel lateral =====
  const PANEL_X = PAGE_W - MARGIN - PANEL_W;
  let cursorY = MARGIN;

  // ---- Bloco 1: identificação ----
  pdf.setFont(FAM, 'bold').setFontSize(9);
  const titleLines = pdf.splitTextToSize(title, PANEL_W - 8) as string[];
  const titleHeight = titleLines.length * 4.2;
  const logoData = companyLogoUrl ? await urlToDataUrl(companyLogoUrl) : null;
  const logoH = logoData ? 14 : 0;
  const block1H = Math.max(34, 8 + logoH + 6 + titleHeight + 6);
  pdf.setDrawColor(0, 0, 0).setLineWidth(0.4);
  pdf.rect(PANEL_X, cursorY, PANEL_W, block1H);

  if (logoData) {
    try {
      const fmt = logoData.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      pdf.addImage(logoData, fmt, PANEL_X + (PANEL_W - 28) / 2, cursorY + 4, 28, logoH, undefined, 'FAST');
    } catch { /* ignore */ }
  }
  pdf.setFont(FAM, 'bold').setFontSize(11).setTextColor(31, 122, 76);
  centerText(companyName, PANEL_X + PANEL_W / 2, cursorY + 8 + logoH + 3);
  pdf.setFont(FAM, 'normal').setFontSize(7.5).setTextColor(80, 80, 80);
  centerText(companyTagline, PANEL_X + PANEL_W / 2, cursorY + 8 + logoH + 7);
  pdf.setDrawColor(180, 180, 180).setLineWidth(0.2);
  pdf.line(PANEL_X + 3, cursorY + 8 + logoH + 9.5, PANEL_X + PANEL_W - 3, cursorY + 8 + logoH + 9.5);
  pdf.setFont(FAM, 'bold').setFontSize(9).setTextColor(0, 0, 0);
  titleLines.forEach((line, i) => {
    centerText(line, PANEL_X + PANEL_W / 2, cursorY + 8 + logoH + 13.5 + i * 4.2);
  });
  cursorY += block1H;

  // ---- Bloco 2: legenda ----
  // Removido o bloco de informações cartográficas e a escala — este mapa é
  // apenas uma representação de localização para anexar ao orçamento.
  const block2H = 38;
  pdf.setDrawColor(0, 0, 0).setLineWidth(0.4);
  pdf.rect(PANEL_X, cursorY, PANEL_W, block2H);
  pdf.setFont(FAM, 'bold').setFontSize(9).setTextColor(0, 0, 0);
  centerText('LEGENDA', PANEL_X + PANEL_W / 2, cursorY + 6);
  const legend: Array<{ swatch: 'main' | 'sigef' | 'sicar'; label: string }> = [
    { swatch: 'main', label: 'Imóvel do Cliente' },
    { swatch: 'sigef', label: 'Imóveis Certificados — SIGEF' },
    { swatch: 'sicar', label: 'Imóveis Cadastrados — CAR' },
  ];
  legend.forEach((item, i) => {
    const y = cursorY + 12 + i * 8;
    const sx = PANEL_X + 4;
    if (item.swatch === 'main') {
      pdf.setFillColor(120, 200, 130);
      pdf.setDrawColor(40, 130, 60).setLineWidth(0.7);
      pdf.rect(sx, y, 7, 4.5, 'FD');
    } else if (item.swatch === 'sigef') {
      pdf.setFillColor(180, 30, 35);
      pdf.setDrawColor(0, 0, 0).setLineWidth(0.2);
      pdf.rect(sx, y, 7, 4.5, 'FD');
    } else {
      pdf.setFillColor(255, 255, 255);
      pdf.setDrawColor(255, 90, 30).setLineWidth(0.8);
      pdf.rect(sx, y, 7, 4.5, 'FD');
    }
    pdf.setFont(FAM, 'normal').setFontSize(7.5).setTextColor(0, 0, 0);
    pdf.text(item.label, sx + 9.5, y + 3.4);
  });
  cursorY += block2H;

  // ---- Bloco 4: assinatura ----
  const block4H = PAGE_H - MARGIN - cursorY;
  pdf.setDrawColor(0, 0, 0).setLineWidth(0.4);
  pdf.rect(PANEL_X, cursorY, PANEL_W, block4H);
  pdf.setFont(FAM, 'bold').setFontSize(8).setTextColor(0, 0, 0);
  centerText('Responsável Técnico', PANEL_X + PANEL_W / 2, cursorY + 5);

  const sigData = responsibleSignatureUrl ? await urlToDataUrl(responsibleSignatureUrl) : null;
  if (sigData) {
    try {
      const fmt = sigData.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      pdf.addImage(sigData, fmt, PANEL_X + 12, cursorY + block4H - 28, PANEL_W - 24, 13, undefined, 'FAST');
    } catch { /* ignore */ }
  }
  pdf.setDrawColor(80, 80, 80).setLineWidth(0.3);
  pdf.line(PANEL_X + 6, cursorY + block4H - 15, PANEL_X + PANEL_W - 6, cursorY + block4H - 15);
  if (responsibleName) {
    pdf.setFont(FAM, 'bold').setFontSize(8).setTextColor(0, 0, 0);
    centerText(responsibleName, PANEL_X + PANEL_W / 2, cursorY + block4H - 11);
    if (responsibleRole) {
      pdf.setFont(FAM, 'normal').setFontSize(7);
      centerText(responsibleRole, PANEL_X + PANEL_W / 2, cursorY + block4H - 7.5);
    }
    if (responsibleRegistry) {
      pdf.setFont(FAM, 'normal').setFontSize(7);
      centerText(responsibleRegistry, PANEL_X + PANEL_W / 2, cursorY + block4H - 4);
    }
  }
  if (producedBy) {
    pdf.setFont(FAM, 'italic').setFontSize(6.5).setTextColor(120, 120, 120);
    centerText(`Produzido por: ${producedBy}`, PANEL_X + PANEL_W / 2, cursorY + block4H - 1);
  }

  pdf.save(`${fileName}.pdf`);
}

function drawNorthArrow(pdf: jsPDF, x: number, y: number, size: number, fam: string) {
  pdf.setFillColor(0, 0, 0).setDrawColor(0, 0, 0);
  pdf.triangle(x + size / 2, y, x, y + size, x + size, y + size, 'F');
  pdf.setFillColor(255, 255, 255);
  pdf.triangle(x + size / 2, y + size * 0.25, x + size * 0.25, y + size * 0.95, x + size * 0.75, y + size * 0.95, 'F');
  pdf.setFillColor(0, 0, 0).setFontSize(7).setFont(fam, 'bold').setTextColor(0, 0, 0);
  pdf.text('N', x + size / 2, y + size + 3, { align: 'center' });
}

function drawGraphicScale(pdf: jsPDF, x: number, y: number, width: number, scale: number, fam: string) {
  const SEG = 4;
  const segW = width / SEG;
  const segMeters = (segW * scale) / 1000;
  const niceMeters = [50, 100, 200, 250, 500, 1000, 2000, 5000].reduce(
    (p, c) => Math.abs(c - segMeters) < Math.abs(p - segMeters) ? c : p, 100,
  );
  const realSegW = (niceMeters * 1000) / scale;
  const realTotalW = realSegW * SEG;

  for (let i = 0; i < SEG; i++) {
    pdf.setFillColor(i % 2 === 0 ? 0 : 255, i % 2 === 0 ? 0 : 255, i % 2 === 0 ? 0 : 255);
    pdf.setDrawColor(0, 0, 0).setLineWidth(0.2);
    pdf.rect(x + i * realSegW, y, realSegW, 1.8, 'FD');
  }
  pdf.setFont(fam, 'normal').setFontSize(6).setTextColor(0, 0, 0);
  pdf.text('0', x, y + 5, { align: 'center' });
  pdf.text(`${((niceMeters * SEG) / 2).toLocaleString('pt-BR')} m`, x + realTotalW / 2, y + 5, { align: 'center' });
  pdf.text(`${(niceMeters * SEG).toLocaleString('pt-BR')} m`, x + realTotalW, y + 5, { align: 'center' });
}
