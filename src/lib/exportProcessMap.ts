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

import { toPng } from 'html-to-image';
import jsPDF from 'jspdf';
import L from 'leaflet';
import bboxClip from '@turf/bbox-clip';
import { embedInterFont } from './pdfFonts';

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
// Usa turf.bboxClip para cortar polígonos que extrapolam o mapa visível.
// Isso evita o bug "faixas diagonais" — polígonos vizinhos enormes que ocupam
// dezenas de km e atravessam o viewport.
function clipToViewport(feature: GeoJSON.Feature, map: L.Map): GeoJSON.Feature | null {
  try {
    const bounds = map.getBounds();
    const padded = bounds.pad(0.05);
    const bbox: [number, number, number, number] = [
      padded.getWest(), padded.getSouth(), padded.getEast(), padded.getNorth(),
    ];
    const clipped = bboxClip(feature as any, bbox);
    const g = clipped.geometry as GeoJSON.Geometry | null;
    if (!g) return null;
    if (g.type === 'Polygon') {
      const rings = (g.coordinates as number[][][]).filter(r => r && r.length >= 4);
      if (rings.length === 0) return null;
      return { type: 'Feature', geometry: { type: 'Polygon', coordinates: rings }, properties: feature.properties ?? {} };
    }
    if (g.type === 'MultiPolygon') {
      const polys = (g.coordinates as number[][][][])
        .map(poly => poly.filter(r => r && r.length >= 4))
        .filter(poly => poly.length > 0);
      if (polys.length === 0) return null;
      return { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: polys }, properties: feature.properties ?? {} };
    }
    return null;
  } catch {
    return null;
  }
}

// Desenha um anel (ring) usando moveTo/lineTo absolutos via jsPDF internal API.
// Evita pdf.lines() que tem bugs com fill+stroke duplicado em rings complexos.
function drawRingAbsolute(
  pdf: jsPDF,
  ringPts: Array<[number, number]>,
  style: 'F' | 'S' | 'B',
) {
  if (ringPts.length < 3) return;
  // jsPDF expõe métodos internos para path absoluto.
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

  const drawRing = (ring: number[][]) => {
    if (ring.length < 2) return;
    const pts = ring.map(([lng, lat]) => proj(lat, lng));
    drawRingSimple(pdf, pts, drawMode);
  };

  if (geom.type === 'Polygon') {
    geom.coordinates.forEach(drawRing);
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates.forEach(poly => poly.forEach(drawRing));
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

  await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  await new Promise(r => setTimeout(r, 250));

  let pngDataUrl: string | null = null;
  try {
    console.log('[exportProcessMap] capturing PNG...');
    pngDataUrl = await toPng(leafletEl, {
      pixelRatio: 2,
      cacheBust: true,
      skipFonts: false,
      includeQueryParams: true,
    });
    console.log('[exportProcessMap] PNG captured, length:', pngDataUrl.length);
  } catch (err) {
    console.error('[exportProcessMap] toPng failed, fallback to vector-only PDF:', err);
  } finally {
    controlsToHide.forEach((el, i) => { el.style.display = prevDisplays[i]; });
    setOverlayTilesVisible?.(true);
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
  const domRect = leafletEl.getBoundingClientRect();
  const targetAspect = MAP_W / MAP_H;
  const sourceAspect = domRect.width / domRect.height;
  let cropSrcX = 0, cropSrcY = 0, cropSrcW = domRect.width, cropSrcH = domRect.height;
  if (sourceAspect > targetAspect) {
    cropSrcW = domRect.height * targetAspect;
    cropSrcX = (domRect.width - cropSrcW) / 2;
  } else {
    cropSrcH = domRect.width / targetAspect;
    cropSrcY = (domRect.height - cropSrcH) / 2;
  }

  if (pngDataUrl) {
    let imgToAdd = pngDataUrl;
    try {
      console.log('[exportProcessMap] cropping PNG', { cropSrcX, cropSrcY, cropSrcW, cropSrcH });
      imgToAdd = await cropPngToAspect(pngDataUrl, cropSrcX, cropSrcY, cropSrcW, cropSrcH, 2);
      console.log('[exportProcessMap] crop OK, length:', imgToAdd.length);
    } catch (err) {
      console.error('[exportProcessMap] crop failed, using original:', err);
    }
    try {
      pdf.addImage(imgToAdd, 'PNG', MARGIN, MARGIN, MAP_W, MAP_H, undefined, 'FAST');
    } catch (err) {
      console.error('[exportProcessMap] addImage failed, continuing without basemap:', err);
    }
  } else {
    console.warn('[exportProcessMap] basemap unavailable, rendering vector-only map');
    pdf.setFillColor(250, 250, 250);
    pdf.rect(MARGIN, MARGIN, MAP_W, MAP_H, 'F');
  }

  const cropMeta = {
    srcX: cropSrcX, srcY: cropSrcY, srcW: cropSrcW, srcH: cropSrcH,
    domW: domRect.width, domH: domRect.height,
  };

  // Desenha vizinhos vetorialmente (vermelho) — RECORTADOS ao viewport.
  if (neighborsFc) {
    const proj = makeProjector(leafletMap, leafletEl, MARGIN, MARGIN, MAP_W, MAP_H, cropMeta);
    const mainCar = (mainFeature?.properties as any)?.cod_imovel;
    neighborsFc.features?.forEach(feat => {
      const car = (feat.properties as any)?.cod_imovel;
      if (mainCar && car && car === mainCar) return;
      const clipped = clipToViewport(feat, leafletMap);
      if (!clipped) return;
      drawGeoFeature(pdf, clipped, proj, {
        stroke: [180, 30, 35],
        strokeWidth: 0.4,
        fill: [220, 60, 60],
        fillOpacity: 0.18,
      });
    });
  }

  // Desenha o imóvel em estudo (verde, traço grosso).
  if (mainFeature) {
    const proj = makeProjector(leafletMap, leafletEl, MARGIN, MARGIN, MAP_W, MAP_H, cropMeta);
    const clipped = clipToViewport(mainFeature, leafletMap) ?? mainFeature;
    drawGeoFeature(pdf, clipped, proj, {
      stroke: [40, 130, 60],
      strokeWidth: 0.9,
      fill: [120, 200, 130],
      fillOpacity: 0.22,
    });
  }

  // Borda do mapa
  pdf.setDrawColor(0, 0, 0).setLineWidth(0.4);
  pdf.rect(MARGIN, MARGIN, MAP_W, MAP_H);

  // Área (canto inferior esquerdo)
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

  // ---- Bloco 2: informações cartográficas ----
  const block2H = 42;
  pdf.setDrawColor(0, 0, 0).setLineWidth(0.4);
  pdf.rect(PANEL_X, cursorY, PANEL_W, block2H);
  pdf.setFont(FAM, 'bold').setFontSize(9).setTextColor(0, 0, 0);
  centerText('Informações Cartográficas', PANEL_X + PANEL_W / 2, cursorY + 5);
  pdf.setFont(FAM, 'normal').setFontSize(7.5);
  const center = leafletMap.getCenter();
  const utmZone = utmZoneFromLng(center.lng);
  const scale = estimateMapScale(leafletMap);
  const infoLines = [
    'Projeção UTM',
    `Zona ${utmZone} — Hemisfério Sul`,
    'Datum: SIRGAS 2000',
    `Escala 1:${scale.toLocaleString('pt-BR')}`,
  ];
  infoLines.forEach((line, i) => {
    centerText(line, PANEL_X + PANEL_W / 2, cursorY + 11 + i * 4);
  });
  pdf.setFont(FAM, 'bold').setFontSize(7.5);
  centerText('Escala Gráfica', PANEL_X + PANEL_W / 2, cursorY + 32);
  drawGraphicScale(pdf, PANEL_X + 5, cursorY + 35, PANEL_W - 10, scale, FAM);
  cursorY += block2H;

  // ---- Bloco 3: legenda ----
  const block3H = 50;
  pdf.setDrawColor(0, 0, 0).setLineWidth(0.4);
  pdf.rect(PANEL_X, cursorY, PANEL_W, block3H);
  pdf.setFont(FAM, 'bold').setFontSize(9).setTextColor(0, 0, 0);
  centerText('LEGENDA', PANEL_X + PANEL_W / 2, cursorY + 6);
  const legend: Array<{ swatch: 'main' | 'neighbor' | 'sigef' | 'sicar'; label: string }> = [
    { swatch: 'main', label: 'Imóvel em Estudo' },
    { swatch: 'neighbor', label: 'Confrontantes (SICAR)' },
    { swatch: 'sigef', label: 'Imóveis Certificados — SIGEF' },
    { swatch: 'sicar', label: 'Imóveis Cadastrados — CAR' },
  ];
  legend.forEach((item, i) => {
    const y = cursorY + 12 + i * 8.5;
    const sx = PANEL_X + 4;
    if (item.swatch === 'main') {
      pdf.setFillColor(120, 200, 130);
      pdf.setDrawColor(40, 130, 60).setLineWidth(0.7);
      pdf.rect(sx, y, 7, 4.5, 'FD');
    } else if (item.swatch === 'neighbor') {
      pdf.setFillColor(220, 60, 60);
      pdf.setDrawColor(180, 30, 35).setLineWidth(0.4);
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
  cursorY += block3H;

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
