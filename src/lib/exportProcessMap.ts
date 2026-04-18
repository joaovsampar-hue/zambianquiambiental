// Exporta o mapa do processo em PDF A4 paisagem replicando o layout
// cartográfico clássico (mapa à esquerda + painel lateral à direita).
//
// Estratégia: captura o `.leaflet-container` atual com html-to-image (PNG),
// depois compõe o PDF com jsPDF — desenhando o mapa à esquerda e o painel
// (logo, título, info cartográficas, escala gráfica, legenda, assinatura) à direita.
//
// Notas:
// - A escala "1:X" exibida é estimada via `map.getZoom()` + latitude (fórmula
//   padrão de Web Mercator). Não é a escala impressa exata, mas é o valor que o
//   usuário vê no Leaflet — coerente com "escala de tela".
// - Tiles externos (Esri, OSM, INCRA) precisam vir com CORS habilitado para
//   serem capturados. Esri World Imagery e nosso proxy SIGEF respondem com
//   `Access-Control-Allow-Origin: *`. Se algum tile faltar, vai aparecer em
//   branco no PDF mas não bloqueia a exportação.

import { toPng } from 'html-to-image';
import jsPDF from 'jspdf';

export interface ExportMapOptions {
  /** Elemento que contém o `.leaflet-container` (ou o container direto). */
  mapContainer: HTMLElement;
  /** Mapa Leaflet ativo — usado pra ler zoom/center/escala. */
  leafletMap: L.Map;
  /** Título do mapa (ex.: "Análise Prévia — Sítio Saltinho — Adamantina/SP"). */
  title: string;
  /** Nome do cliente (aparece no rodapé do painel se quiser). */
  clientName?: string;
  /** Profissional responsável (aparece na assinatura). */
  responsibleName?: string;
  /** Registro do CREA/CFT do responsável. */
  responsibleRegistry?: string;
  /** Quem produziu (assistente técnico). */
  producedBy?: string;
  /** Nome do arquivo (sem extensão). */
  fileName?: string;
  /** Área em hectares do imóvel principal — exibida sobre o mapa. */
  areaHa?: number;
}

// Calcula a escala aproximada na tela em zoom Web Mercator.
// Fórmula: metersPerPixel = (cos(lat) * 2π * R) / (256 * 2^zoom)
// Escala 1:X (tela) = metersPerPixel * dpiPx / 0.0254
function estimateMapScale(map: L.Map): number {
  const center = map.getCenter();
  const zoom = map.getZoom();
  const R = 6378137; // raio equatorial WGS84
  const metersPerPixel = (Math.cos((center.lat * Math.PI) / 180) * 2 * Math.PI * R) / (256 * Math.pow(2, zoom));
  // 96 DPI = 1 px = 0.0264583 cm
  const scale = metersPerPixel * 96 / 0.0254;
  // Arredonda pra escala "amigável" (1k, 2k, 5k, 10k, 12k, 25k, 50k...)
  const niceScales = [500, 1000, 2000, 2500, 5000, 7500, 10000, 12000, 15000, 25000, 50000, 100000, 250000];
  return niceScales.reduce((prev, curr) => Math.abs(curr - scale) < Math.abs(prev - scale) ? curr : prev, niceScales[0]);
}

// Determina a zona UTM a partir da longitude (Brasil: zonas 18-25).
function utmZoneFromLng(lng: number): number {
  return Math.floor((lng + 180) / 6) + 1;
}

export async function exportProcessMap(opts: ExportMapOptions): Promise<void> {
  const {
    mapContainer, leafletMap, title,
    responsibleName, responsibleRegistry, producedBy,
    fileName = 'mapa-processo', areaHa,
  } = opts;

  const leafletEl = (mapContainer.querySelector('.leaflet-container') as HTMLElement) ?? mapContainer;

  // Esconde controles temporariamente — vão ficar feios no PDF.
  const controlsToHide = leafletEl.querySelectorAll<HTMLElement>('.leaflet-control-zoom, .leaflet-control-layers, .leaflet-control-attribution');
  const prevDisplays = Array.from(controlsToHide).map(el => el.style.display);
  controlsToHide.forEach(el => { el.style.display = 'none'; });

  let pngDataUrl: string;
  try {
    // Aumenta o pixelRatio para um PNG nítido (impressão).
    pngDataUrl = await toPng(leafletEl, {
      pixelRatio: 2,
      cacheBust: true,
      // Tiles cross-origin: deixa o html-to-image lidar; se algum falhar, segue.
      skipFonts: false,
    });
  } finally {
    controlsToHide.forEach((el, i) => { el.style.display = prevDisplays[i]; });
  }

  // ===== Monta PDF A4 paisagem (297 × 210 mm) =====
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const PAGE_W = 297, PAGE_H = 210;
  const MARGIN = 6;
  const PANEL_W = 70; // largura do painel lateral direito
  const MAP_W = PAGE_W - MARGIN * 2 - PANEL_W - 2;
  const MAP_H = PAGE_H - MARGIN * 2;

  // Borda externa
  pdf.setDrawColor(0).setLineWidth(0.4);
  pdf.rect(MARGIN, MARGIN, PAGE_W - MARGIN * 2, PAGE_H - MARGIN * 2);

  // ===== Mapa (esquerda) =====
  pdf.addImage(pngDataUrl, 'PNG', MARGIN, MARGIN, MAP_W, MAP_H, undefined, 'FAST');
  // Reborda o mapa
  pdf.rect(MARGIN, MARGIN, MAP_W, MAP_H);

  // Área (texto sobreposto sobre o mapa, canto inferior esquerdo)
  if (areaHa != null) {
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(180);
    const txt = `Área: ${areaHa.toFixed(3)} ha`;
    pdf.setFontSize(10);
    const w = pdf.getTextWidth(txt) + 4;
    pdf.rect(MARGIN + 3, MARGIN + MAP_H - 9, w, 6, 'FD');
    pdf.setTextColor(0).text(txt, MARGIN + 5, MARGIN + MAP_H - 4.5);
  }

  // Seta-norte (canto superior esquerdo do mapa)
  drawNorthArrow(pdf, MARGIN + 6, MARGIN + 6, 10);

  // ===== Painel lateral (direita) =====
  const PANEL_X = PAGE_W - MARGIN - PANEL_W;
  const PANEL_Y = MARGIN;
  let cursorY = PANEL_Y;

  // Bloco 1: logo placeholder + título
  const block1H = 50;
  pdf.rect(PANEL_X, cursorY, PANEL_W, block1H);
  // Logo placeholder (texto, pode ser substituído por imagem futuramente)
  pdf.setFontSize(11).setFont('helvetica', 'bold').setTextColor(31, 122, 76);
  pdf.text('GeoConfront', PANEL_X + PANEL_W / 2, cursorY + 8, { align: 'center' });
  pdf.setFontSize(8).setFont('helvetica', 'normal').setTextColor(80);
  pdf.text('Análise de Confrontantes', PANEL_X + PANEL_W / 2, cursorY + 12.5, { align: 'center' });
  // Linha separadora
  pdf.setDrawColor(180).line(PANEL_X + 3, cursorY + 16, PANEL_X + PANEL_W - 3, cursorY + 16);
  // Título do mapa (multi-linha)
  pdf.setFontSize(9).setFont('helvetica', 'bold').setTextColor(0);
  const titleLines = pdf.splitTextToSize(title, PANEL_W - 6);
  pdf.text(titleLines, PANEL_X + PANEL_W / 2, cursorY + 22, { align: 'center', baseline: 'top' });
  cursorY += block1H;

  // Bloco 2: Informações cartográficas
  const block2H = 40;
  pdf.rect(PANEL_X, cursorY, PANEL_W, block2H);
  pdf.setFontSize(9).setFont('helvetica', 'bold').setTextColor(0);
  pdf.text('Informações Cartográficas', PANEL_X + PANEL_W / 2, cursorY + 5, { align: 'center' });
  pdf.setFontSize(7.5).setFont('helvetica', 'normal');
  const center = leafletMap.getCenter();
  const utmZone = utmZoneFromLng(center.lng);
  const scale = estimateMapScale(leafletMap);
  const infoLines = [
    'Projeção Universal Transversa de Mercator',
    `UTM Zona ${utmZone} — Hemisfério Sul`,
    'Datum Horizontal: SIRGAS 2000',
    `Escala 1:${scale.toLocaleString('pt-BR')}`,
  ];
  infoLines.forEach((line, i) => {
    pdf.text(line, PANEL_X + PANEL_W / 2, cursorY + 11 + i * 4, { align: 'center' });
  });
  // Escala gráfica
  pdf.setFontSize(8).setFont('helvetica', 'bold');
  pdf.text('Escala Gráfica', PANEL_X + PANEL_W / 2, cursorY + 30, { align: 'center' });
  drawGraphicScale(pdf, PANEL_X + 5, cursorY + 35, PANEL_W - 10, scale);
  cursorY += block2H;

  // Bloco 3: Legenda
  const block3H = 70;
  pdf.rect(PANEL_X, cursorY, PANEL_W, block3H);
  pdf.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0);
  pdf.text('LEGENDA', PANEL_X + PANEL_W / 2, cursorY + 6, { align: 'center' });
  const legend: Array<{ color: [number, number, number]; border?: [number, number, number]; hatch?: boolean; outline?: boolean; label: string }> = [
    { color: [180, 30, 35], label: 'Imóveis Certificados — SIGEF' },
    { color: [255, 255, 255], outline: true, border: [255, 90, 30], label: 'Imóveis — CAR (SICAR)' },
    { color: [255, 255, 255], hatch: true, border: [60, 180, 75], label: 'Imóvel em Estudo' },
    { color: [120, 120, 120], label: 'Imóveis Confrontantes Cadastrados' },
  ];
  legend.forEach((item, i) => {
    const y = cursorY + 12 + i * 9;
    const sx = PANEL_X + 5;
    // Símbolo
    if (item.hatch) {
      pdf.setFillColor(255, 255, 255);
      pdf.setDrawColor(item.border![0], item.border![1], item.border![2]).setLineWidth(0.6);
      pdf.rect(sx, y, 8, 5, 'FD');
      // Hachura simples (3 linhas diagonais)
      pdf.setDrawColor(60, 180, 75).setLineWidth(0.3);
      pdf.line(sx, y + 5, sx + 5, y);
      pdf.line(sx + 1.5, y + 5, sx + 6.5, y);
      pdf.line(sx + 3, y + 5, sx + 8, y);
    } else if (item.outline) {
      pdf.setFillColor(255, 255, 255);
      pdf.setDrawColor(item.border![0], item.border![1], item.border![2]).setLineWidth(0.8);
      pdf.rect(sx, y, 8, 5, 'FD');
    } else {
      pdf.setFillColor(item.color[0], item.color[1], item.color[2]);
      pdf.setDrawColor(0).setLineWidth(0.2);
      pdf.rect(sx, y, 8, 5, 'FD');
    }
    pdf.setFontSize(8).setFont('helvetica', 'normal').setTextColor(0);
    pdf.text(item.label, sx + 11, y + 3.7);
  });
  cursorY += block3H;

  // Bloco 4: Assinatura
  const block4H = PAGE_H - MARGIN - cursorY;
  pdf.rect(PANEL_X, cursorY, PANEL_W, block4H);
  if (responsibleName) {
    pdf.setDrawColor(80).setLineWidth(0.3);
    pdf.line(PANEL_X + 6, cursorY + block4H - 14, PANEL_X + PANEL_W - 6, cursorY + block4H - 14);
    pdf.setFontSize(8).setFont('helvetica', 'normal').setTextColor(0);
    pdf.text(responsibleName, PANEL_X + PANEL_W / 2, cursorY + block4H - 10, { align: 'center' });
    if (responsibleRegistry) {
      pdf.setFontSize(7);
      pdf.text(responsibleRegistry, PANEL_X + PANEL_W / 2, cursorY + block4H - 6.5, { align: 'center' });
    }
  }
  if (producedBy) {
    pdf.setFontSize(6.5).setTextColor(120);
    pdf.text(`Produzido por: ${producedBy}`, PANEL_X + PANEL_W / 2, cursorY + block4H - 2, { align: 'center' });
  }

  // Salva
  pdf.save(`${fileName}.pdf`);
}

function drawNorthArrow(pdf: jsPDF, x: number, y: number, size: number) {
  // Triângulo preto apontando pra cima + "N"
  pdf.setFillColor(0).setDrawColor(0);
  pdf.triangle(x + size / 2, y, x, y + size, x + size, y + size, 'F');
  pdf.setFillColor(255, 255, 255);
  pdf.triangle(x + size / 2, y + size * 0.25, x + size * 0.25, y + size * 0.95, x + size * 0.75, y + size * 0.95, 'F');
  pdf.setFillColor(0).setFontSize(7).setFont('helvetica', 'bold').setTextColor(0);
  pdf.text('N', x + size / 2, y + size + 3, { align: 'center' });
}

function drawGraphicScale(pdf: jsPDF, x: number, y: number, width: number, scale: number) {
  // Cada segmento representa uma fração da escala. Usa 4 segmentos.
  const SEG = 4;
  const segW = width / SEG;
  // Distância real de cada segmento em metros
  // Em 1:X, 1mm no papel = X/1000 metros no terreno → segW (mm) * scale/1000 = metros
  const segMeters = (segW * scale) / 1000;
  // Arredonda pra valor amigável (50, 100, 200, 500, 1000, 2000, 5000)
  const niceMeters = [50, 100, 200, 250, 500, 1000, 2000, 5000].reduce(
    (p, c) => Math.abs(c - segMeters) < Math.abs(p - segMeters) ? c : p, 100
  );
  // Recalcula segW para o valor arredondado caber proporcionalmente
  const realSegW = (niceMeters * 1000) / scale;
  const realTotalW = realSegW * SEG;

  // Barras alternadas preto/branco
  for (let i = 0; i < SEG; i++) {
    pdf.setFillColor(i % 2 === 0 ? 0 : 255, i % 2 === 0 ? 0 : 255, i % 2 === 0 ? 0 : 255);
    pdf.setDrawColor(0).setLineWidth(0.2);
    pdf.rect(x + i * realSegW, y, realSegW, 1.8, 'FD');
  }
  // Rótulos
  pdf.setFontSize(6).setTextColor(0);
  pdf.text('0', x, y + 5, { align: 'center' });
  pdf.text(`${((niceMeters * SEG) / 2).toLocaleString('pt-BR')} m`, x + realTotalW / 2, y + 5, { align: 'center' });
  pdf.text(`${(niceMeters * SEG).toLocaleString('pt-BR')} m`, x + realTotalW, y + 5, { align: 'center' });
}
