// QA do exportProcessMap atualizado — replica o layout de produção em Node.
import { jsPDF } from 'jspdf';
import fs from 'fs';

const fakeMap = { getCenter: () => ({ lat: -21.46, lng: -51.18 }), getZoom: () => 16 };

function estimateMapScale(map) {
  const center = map.getCenter();
  const zoom = map.getZoom();
  const R = 6378137;
  const metersPerPixel = (Math.cos((center.lat * Math.PI) / 180) * 2 * Math.PI * R) / (256 * Math.pow(2, zoom));
  const scale = metersPerPixel * 96 / 0.0254;
  const niceScales = [500, 1000, 2000, 2500, 5000, 7500, 10000, 12000, 15000, 25000, 50000, 100000, 250000];
  return niceScales.reduce((prev, curr) => Math.abs(curr - scale) < Math.abs(prev - scale) ? curr : prev, niceScales[0]);
}
function utmZoneFromLng(lng) { return Math.floor((lng + 180) / 6) + 1; }

function drawNorthArrow(pdf, x, y, size) {
  pdf.setFillColor(0,0,0).setDrawColor(0,0,0);
  pdf.triangle(x + size / 2, y, x, y + size, x + size, y + size, 'F');
  pdf.setFillColor(255, 255, 255);
  pdf.triangle(x + size / 2, y + size * 0.25, x + size * 0.25, y + size * 0.95, x + size * 0.75, y + size * 0.95, 'F');
  pdf.setFillColor(0,0,0).setFontSize(7).setFont('helvetica', 'bold').setTextColor(0,0,0);
  pdf.text('N', x + size / 2 - pdf.getTextWidth('N') / 2, y + size + 3);
}

function drawGraphicScale(pdf, x, y, width, scale) {
  const SEG = 4;
  const segW = width / SEG;
  const segMeters = (segW * scale) / 1000;
  const niceMeters = [50, 100, 200, 250, 500, 1000, 2000, 5000].reduce(
    (p, c) => Math.abs(c - segMeters) < Math.abs(p - segMeters) ? c : p, 100
  );
  const realSegW = (niceMeters * 1000) / scale;
  const realTotalW = realSegW * SEG;
  for (let i = 0; i < SEG; i++) {
    pdf.setFillColor(i % 2 === 0 ? 0 : 255, i % 2 === 0 ? 0 : 255, i % 2 === 0 ? 0 : 255);
    pdf.setDrawColor(0,0,0).setLineWidth(0.2);
    pdf.rect(x + i * realSegW, y, realSegW, 1.8, 'FD');
  }
  pdf.setFontSize(6).setTextColor(0,0,0);
  const t1 = '0', t2 = `${((niceMeters * SEG) / 2).toLocaleString('pt-BR')} m`, t3 = `${(niceMeters * SEG).toLocaleString('pt-BR')} m`;
  pdf.text(t1, x - pdf.getTextWidth(t1)/2, y + 5);
  pdf.text(t2, x + realTotalW/2 - pdf.getTextWidth(t2)/2, y + 5);
  pdf.text(t3, x + realTotalW - pdf.getTextWidth(t3)/2, y + 5);
}

const opts = {
  title: 'Análise Prévia — Sítio Saltinho — Adamantina/SP',
  responsibleName: 'João Silva',
  responsibleRegistry: 'CREA-SP 1234567',
  producedBy: 'Maria Santos',
  fileName: '/tmp/qa-export-v2',
  areaHa: 35.012,
};

const pngDataUrl = 'data:image/png;base64,' + fs.readFileSync('/tmp/placeholder.b64', 'utf8').trim();
const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
const PAGE_W = 297, PAGE_H = 210;
const MARGIN = 6;
const PANEL_W = 72;
const GAP = 2;
const MAP_W = PAGE_W - MARGIN * 2 - PANEL_W - GAP;
const MAP_H = PAGE_H - MARGIN * 2;

const centerText = (text, x, y, o) => {
  const w = pdf.getTextWidth(text);
  pdf.text(text, x - w/2, y, o ? { baseline: o.baseline } : undefined);
};

pdf.setDrawColor(0,0,0).setLineWidth(0.4);
pdf.rect(MARGIN, MARGIN, PAGE_W - MARGIN*2, PAGE_H - MARGIN*2);
pdf.addImage(pngDataUrl, 'PNG', MARGIN, MARGIN, MAP_W, MAP_H, undefined, 'FAST');
pdf.rect(MARGIN, MARGIN, MAP_W, MAP_H);

if (opts.areaHa != null) {
  pdf.setFillColor(255,255,255).setDrawColor(180,180,180);
  pdf.setFont('helvetica','normal').setFontSize(10).setTextColor(0,0,0);
  const txt = `Área: ${opts.areaHa.toFixed(3)} ha`;
  const w = pdf.getTextWidth(txt) + 4;
  pdf.rect(MARGIN+3, MARGIN+MAP_H-9, w, 6, 'FD');
  pdf.text(txt, MARGIN+5, MARGIN+MAP_H-4.5);
}
drawNorthArrow(pdf, MARGIN+6, MARGIN+6, 10);

const PANEL_X = PAGE_W - MARGIN - PANEL_W;
let cursorY = MARGIN;

// Bloco 1
pdf.setFont('helvetica','bold').setFontSize(9);
const titleLines = pdf.splitTextToSize(opts.title, PANEL_W - 8);
const titleHeight = titleLines.length * 4.2;
const block1H = Math.max(28, 18 + titleHeight + 4);
pdf.setDrawColor(0,0,0).setLineWidth(0.4);
pdf.rect(PANEL_X, cursorY, PANEL_W, block1H);
pdf.setFont('helvetica','bold').setFontSize(11).setTextColor(31,122,76);
centerText('GeoConfront', PANEL_X + PANEL_W/2, cursorY + 7);
pdf.setFont('helvetica','normal').setFontSize(7.5).setTextColor(80,80,80);
centerText('Análise de Confrontantes', PANEL_X + PANEL_W/2, cursorY + 11.5);
pdf.setDrawColor(180,180,180).setLineWidth(0.2);
pdf.line(PANEL_X+3, cursorY+14.5, PANEL_X+PANEL_W-3, cursorY+14.5);
pdf.setFont('helvetica','bold').setFontSize(9).setTextColor(0,0,0);
titleLines.forEach((line, i) => centerText(line, PANEL_X + PANEL_W/2, cursorY + 19 + i*4.2));
cursorY += block1H;

// Bloco 2
const block2H = 42;
pdf.setDrawColor(0,0,0).setLineWidth(0.4);
pdf.rect(PANEL_X, cursorY, PANEL_W, block2H);
pdf.setFont('helvetica','bold').setFontSize(9).setTextColor(0,0,0);
centerText('Informações Cartográficas', PANEL_X + PANEL_W/2, cursorY + 5);
pdf.setFont('helvetica','normal').setFontSize(7.5);
const utmZone = utmZoneFromLng(fakeMap.getCenter().lng);
const scale = estimateMapScale(fakeMap);
['Projeção UTM', `Zona ${utmZone} — Hemisfério Sul`, 'Datum: SIRGAS 2000', `Escala 1:${scale.toLocaleString('pt-BR')}`]
  .forEach((line, i) => centerText(line, PANEL_X + PANEL_W/2, cursorY + 11 + i*4));
pdf.setFont('helvetica','bold').setFontSize(7.5);
centerText('Escala Gráfica', PANEL_X + PANEL_W/2, cursorY + 32);
drawGraphicScale(pdf, PANEL_X+5, cursorY+35, PANEL_W-10, scale);
cursorY += block2H;

// Bloco 3
const block3H = 50;
pdf.setDrawColor(0,0,0).setLineWidth(0.4);
pdf.rect(PANEL_X, cursorY, PANEL_W, block3H);
pdf.setFont('helvetica','bold').setFontSize(9).setTextColor(0,0,0);
centerText('LEGENDA', PANEL_X + PANEL_W/2, cursorY + 6);
const legend = [
  { color: [180,30,35], label: 'Imóveis Certificados — SIGEF' },
  { color: [255,255,255], outline: true, border: [255,90,30], label: 'Imóveis — CAR (SICAR)' },
  { color: [255,255,255], hatch: true, border: [60,180,75], label: 'Imóvel em Estudo' },
  { color: [120,120,120], label: 'Confrontantes Cadastrados' },
];
legend.forEach((item, i) => {
  const y = cursorY + 12 + i*8.5;
  const sx = PANEL_X + 4;
  if (item.hatch) {
    pdf.setFillColor(255,255,255).setDrawColor(item.border[0],item.border[1],item.border[2]).setLineWidth(0.6);
    pdf.rect(sx, y, 7, 4.5, 'FD');
    pdf.setDrawColor(60,180,75).setLineWidth(0.3);
    pdf.line(sx, y+4.5, sx+4.5, y);
    pdf.line(sx+1.5, y+4.5, sx+6, y);
    pdf.line(sx+3, y+4.5, sx+7, y);
  } else if (item.outline) {
    pdf.setFillColor(255,255,255).setDrawColor(item.border[0],item.border[1],item.border[2]).setLineWidth(0.8);
    pdf.rect(sx, y, 7, 4.5, 'FD');
  } else {
    pdf.setFillColor(item.color[0],item.color[1],item.color[2]).setDrawColor(0,0,0).setLineWidth(0.2);
    pdf.rect(sx, y, 7, 4.5, 'FD');
  }
  pdf.setFont('helvetica','normal').setFontSize(7.5).setTextColor(0,0,0);
  pdf.text(item.label, sx+9.5, y+3.4);
});
cursorY += block3H;

// Bloco 4
const block4H = PAGE_H - MARGIN - cursorY;
pdf.setDrawColor(0,0,0).setLineWidth(0.4);
pdf.rect(PANEL_X, cursorY, PANEL_W, block4H);
pdf.setFont('helvetica','bold').setFontSize(8).setTextColor(0,0,0);
centerText('Responsável Técnico', PANEL_X + PANEL_W/2, cursorY + 5);
pdf.setDrawColor(80,80,80).setLineWidth(0.3);
pdf.line(PANEL_X+6, cursorY+block4H-13, PANEL_X+PANEL_W-6, cursorY+block4H-13);
if (opts.responsibleName) {
  pdf.setFont('helvetica','normal').setFontSize(8).setTextColor(0,0,0);
  centerText(opts.responsibleName, PANEL_X + PANEL_W/2, cursorY+block4H-9);
  if (opts.responsibleRegistry) {
    pdf.setFontSize(7);
    centerText(opts.responsibleRegistry, PANEL_X + PANEL_W/2, cursorY+block4H-5.5);
  }
}
if (opts.producedBy) {
  pdf.setFont('helvetica','italic').setFontSize(6.5).setTextColor(120,120,120);
  centerText(`Produzido por: ${opts.producedBy}`, PANEL_X + PANEL_W/2, cursorY+block4H-1.5);
}

fs.writeFileSync('/tmp/qa-export-v2.pdf', Buffer.from(pdf.output('arraybuffer')));
console.log('Wrote /tmp/qa-export-v2.pdf');
console.log(`block1H=${block1H} block2H=${block2H} block3H=${block3H} block4H=${block4H}`);
console.log(`cursorY total=${cursorY + block4H}, PAGE_H-MARGIN=${PAGE_H - MARGIN}`);
