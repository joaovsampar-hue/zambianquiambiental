// Exporta o mapa do processo em PDF A4 paisagem com layout cartográfico clássico.
//
// Estratégia (v2):
// - Captura o basemap (satélite/ruas) via html-to-image, mas ESCONDE as camadas
//   WMS SIGEF/SICAR antes da captura (elas geram hachura raster que polui).
// - Por cima da imagem do basemap, desenha os polígonos vetorialmente direto no
//   jsPDF — projetando lat/lng → pixel via Web Mercator + bounds do mapa atual:
//     * Vizinhos detectados (azul claro)
//     * Imóvel principal (verde, hachurado, com destaque no topo)
// - Painel lateral: logo da empresa (carregada do banco), título dinâmico
//   (formato "Análise Prévia - Imóvel - Município/UF"), informações cartográficas,
//   legenda, escala gráfica e bloco de assinatura do RT.
//
// Notas:
// - A escala "1:X" exibida é estimada via map.getZoom() + latitude (Web Mercator).
// - Se a Inter não baixar (cache CDN), fallback silencioso pra helvetica.
// - Se não houver logo cadastrada, usa o nome "GeoConfront" como placeholder.

import { toPng } from 'html-to-image';
import jsPDF from 'jspdf';
import L from 'leaflet';
import { embedInterFont } from './pdfFonts';

export interface ExportMapOptions {
  /** Elemento que contém o `.leaflet-container` (ou o container direto). */
  mapContainer: HTMLElement;
  /** Mapa Leaflet ativo — usado pra ler zoom/center/escala. */
  leafletMap: L.Map;
  /** Polígono do imóvel em estudo (destaque verde). */
  mainFeature: GeoJSON.Feature | null;
  /** Vizinhos detectados (azul claro). */
  neighborsFc: GeoJSON.FeatureCollection | null;
  /** Função opcional para esconder/mostrar camadas WMS durante a captura. */
  setOverlayTilesVisible?: (visible: boolean) => void;
  /** Título do mapa (ex.: "Análise Prévia - Sítio Saltinho - Adamantina/SP"). */
  title: string;
  /** Nome do cliente (aparece no rodapé do painel se quiser). */
  clientName?: string;
  /** Profissional responsável (aparece na assinatura). */
  responsibleName?: string;
  /** Cargo (ex.: "Engenheiro Agrimensor"). */
  responsibleRole?: string;
  /** Tipo+número do registro (ex.: "CREA-SP 5070123456"). */
  responsibleRegistry?: string;
  /** URL pública (PNG transparente) da assinatura digitalizada do RT. */
  responsibleSignatureUrl?: string;
  /** Quem produziu (assistente técnico). */
  producedBy?: string;
  /** Nome da empresa (default: "GeoConfront"). */
  companyName?: string;
  /** Subtítulo da empresa. */
  companyTagline?: string;
  /** URL pública do logo da empresa (PNG/JPG). */
  companyLogoUrl?: string;
  /** Nome do arquivo (sem extensão). */
  fileName?: string;
  /** Área em hectares do imóvel principal — exibida sobre o mapa. */
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

// Carrega imagem de URL pública como dataURL — necessário pra jsPDF.addImage.
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

// ===== Projeção lat/lng → coordenadas no PDF =====
// O mapa Leaflet projeta em Web Mercator. Para desenhar polígonos no jsPDF
// alinhados com a captura, usamos `map.latLngToContainerPoint` (que retorna px
// dentro do container DOM) e mapeamos para mm dentro do retângulo do mapa no PDF.
function makeProjector(map: L.Map, mapDom: HTMLElement, pdfX: number, pdfY: number, pdfW: number, pdfH: number) {
  const rect = mapDom.getBoundingClientRect();
  const scaleX = pdfW / rect.width;
  const scaleY = pdfH / rect.height;
  return (lat: number, lng: number): [number, number] => {
    const p = map.latLngToContainerPoint([lat, lng]);
    return [pdfX + p.x * scaleX, pdfY + p.y * scaleY];
  };
}

type Projector = ReturnType<typeof makeProjector>;

// Desenha um polígono GeoJSON (Polygon ou MultiPolygon) no jsPDF.
function drawGeoFeature(
  pdf: jsPDF,
  feature: GeoJSON.Feature,
  proj: Projector,
  style: {
    stroke: [number, number, number];
    strokeWidth: number;
    fill?: [number, number, number] | null;
    fillOpacity?: number;
    hatch?: boolean;
  },
) {
  const geom = feature.geometry;
  if (!geom) return;

  const drawRing = (ring: number[][]) => {
    if (ring.length < 2) return;
    const pts = ring.map(([lng, lat]) => proj(lat, lng));
    // Path: moveTo + lineTo + close. jsPDF não tem Path API direta, usamos lines().
    const lines: [number, number][] = [];
    for (let i = 1; i < pts.length; i++) {
      lines.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
    }
    pdf.setDrawColor(style.stroke[0], style.stroke[1], style.stroke[2]);
    pdf.setLineWidth(style.strokeWidth);
    if (style.fill) {
      pdf.setFillColor(style.fill[0], style.fill[1], style.fill[2]);
      // jsPDF não tem fill com opacity nativo; simulamos com setGState se disponível.
      const gs = (pdf as any).GState ? new (pdf as any).GState({ opacity: style.fillOpacity ?? 0.3 }) : null;
      if (gs) (pdf as any).setGState(gs);
      pdf.lines(lines, pts[0][0], pts[0][1], [1, 1], 'F', true);
      if (gs) (pdf as any).setGState(new (pdf as any).GState({ opacity: 1 }));
    }
    // Stroke por cima
    pdf.lines(lines, pts[0][0], pts[0][1], [1, 1], 'S', true);
  };

  if (geom.type === 'Polygon') {
    geom.coordinates.forEach(drawRing);
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates.forEach(poly => poly.forEach(drawRing));
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

  const leafletEl = (mapContainer.querySelector('.leaflet-container') as HTMLElement) ?? mapContainer;

  // Esconde controles + camadas WMS de hachura.
  const controlsToHide = leafletEl.querySelectorAll<HTMLElement>(
    '.leaflet-control-zoom, .leaflet-control-layers, .leaflet-control-attribution',
  );
  const prevDisplays = Array.from(controlsToHide).map(el => el.style.display);
  controlsToHide.forEach(el => { el.style.display = 'none'; });
  setOverlayTilesVisible?.(false);

  // Pequeno delay para o Leaflet aplicar o `visibility:hidden` antes do snapshot.
  await new Promise(r => setTimeout(r, 120));

  let pngDataUrl: string;
  try {
    pngDataUrl = await toPng(leafletEl, { pixelRatio: 2, cacheBust: true, skipFonts: false });
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

  // Helper: centraliza texto manualmente (evita ghost spacing em alguns viewers).
  const centerText = (text: string, x: number, y: number) => {
    const w = pdf.getTextWidth(text);
    pdf.text(text, x - w / 2, y);
  };

  // Borda externa
  pdf.setDrawColor(0, 0, 0).setLineWidth(0.4);
  pdf.rect(MARGIN, MARGIN, PAGE_W - MARGIN * 2, PAGE_H - MARGIN * 2);

  // ===== Mapa (esquerda) — basemap + polígonos vetoriais =====
  pdf.addImage(pngDataUrl, 'PNG', MARGIN, MARGIN, MAP_W, MAP_H, undefined, 'FAST');

  // Desenha vizinhos vetorialmente (azul claro)
  if (neighborsFc) {
    const proj = makeProjector(leafletMap, leafletEl, MARGIN, MARGIN, MAP_W, MAP_H);
    neighborsFc.features?.forEach(feat => {
      drawGeoFeature(pdf, feat, proj, {
        stroke: [180, 30, 35],
        strokeWidth: 0.4,
        fill: [220, 60, 60],
        fillOpacity: 0.18,
      });
    });
  }

  // Desenha o imóvel em estudo (verde, traço grosso, hachura translúcida)
  if (mainFeature) {
    const proj = makeProjector(leafletMap, leafletEl, MARGIN, MARGIN, MAP_W, MAP_H);
    drawGeoFeature(pdf, mainFeature, proj, {
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

  // ---- Bloco 1: identificação (logo + nome empresa + título do mapa) ----
  pdf.setFont(FAM, 'bold').setFontSize(9);
  const titleLines = pdf.splitTextToSize(title, PANEL_W - 8) as string[];
  const titleHeight = titleLines.length * 4.2;
  // Carrega logo da empresa (se disponível)
  const logoData = companyLogoUrl ? await urlToDataUrl(companyLogoUrl) : null;
  const logoH = logoData ? 14 : 0;
  const block1H = Math.max(34, 8 + logoH + 6 + titleHeight + 6);
  pdf.setDrawColor(0, 0, 0).setLineWidth(0.4);
  pdf.rect(PANEL_X, cursorY, PANEL_W, block1H);

  if (logoData) {
    try {
      const fmt = logoData.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      pdf.addImage(logoData, fmt, PANEL_X + (PANEL_W - 28) / 2, cursorY + 4, 28, logoH, undefined, 'FAST');
    } catch { /* ignore corrupt image */ }
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

  // Assinatura digitalizada (PNG transparente) acima da linha
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
  pdf.text('N', x + size / 2 - pdf.getTextWidth('N') / 2, y + size + 3);
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
  const c = (s: string, cx: number) => pdf.text(s, cx - pdf.getTextWidth(s) / 2, y + 5);
  c('0', x);
  c(`${((niceMeters * SEG) / 2).toLocaleString('pt-BR')} m`, x + realTotalW / 2);
  c(`${(niceMeters * SEG).toLocaleString('pt-BR')} m`, x + realTotalW);
}
