// Reproduz exportProcessMap em Node para QA visual do layout do PDF.
// Usa um PNG placeholder (gradiente verde simulando satélite) no lugar
// da captura do Leaflet. Tudo o resto (painel, escala, legenda, assinatura)
// é idêntico ao código de produção em src/lib/exportProcessMap.ts.
import { jsPDF } from 'jspdf';
import fs from 'fs';

// Stub de "L.Map.getCenter() / getZoom()"
const fakeMap = {
  getCenter: () => ({ lat: -21.46, lng: -51.18 }),
  getZoom: () => 16,
};

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
  pdf.text('N', x + size / 2, y + size + 3, { align: 'center' });
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
  pdf.text('0', x, y + 5, { align: 'center' });
  pdf.text(`${((niceMeters * SEG) / 2).toLocaleString('pt-BR')} m`, x + realTotalW / 2, y + 5, { align: 'center' });
  pdf.text(`${(niceMeters * SEG).toLocaleString('pt-BR')} m`, x + realTotalW, y + 5, { align: 'center' });
}

// PNG placeholder — 1200x800 verde escuro (simula tile satélite)
async function makePlaceholderPng() {
  const b64 = fs.readFileSync('/tmp/placeholder.b64', 'utf8').trim();
  return 'data:image/png;base64,' + b64;
}

const opts = {
  title: 'Análise Prévia — Sítio Saltinho — Adamantina/SP',
  responsibleName: 'João Silva',
  responsibleRegistry: 'CREA-SP 1234567',
  producedBy: 'Maria Santos',
  fileName: '/tmp/qa-export',
  areaHa: 35.012,
};

const pngDataUrl = await makePlaceholderPng();

const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
const PAGE_W = 297, PAGE_H = 210;
const MARGIN = 6;
const PANEL_W = 70;
const MAP_W = PAGE_W - MARGIN * 2 - PANEL_W - 2;
const MAP_H = PAGE_H - MARGIN * 2;

pdf.setDrawColor(0,0,0).setLineWidth(0.4);
pdf.rect(MARGIN, MARGIN, PAGE_W - MARGIN * 2, PAGE_H - MARGIN * 2);

pdf.addImage(pngDataUrl, 'PNG', MARGIN, MARGIN, MAP_W, MAP_H, undefined, 'FAST');
pdf.rect(MARGIN, MARGIN, MAP_W, MAP_H);

if (opts.areaHa != null) {
  pdf.setFillColor(255, 255, 255).setDrawColor(180,180,180);
  const txt = `Área: ${opts.areaHa.toFixed(3)} ha`;
  pdf.setFontSize(10);
  const w = pdf.getTextWidth(txt) + 4;
  pdf.rect(MARGIN + 3, MARGIN + MAP_H - 9, w, 6, 'FD');
  pdf.setTextColor(0,0,0).text(txt, MARGIN + 5, MARGIN + MAP_H - 4.5);
}
drawNorthArrow(pdf, MARGIN + 6, MARGIN + 6, 10);

const PANEL_X = PAGE_W - MARGIN - PANEL_W;
const PANEL_Y = MARGIN;
let cursorY = PANEL_Y;

const block1H = 50;
pdf.rect(PANEL_X, cursorY, PANEL_W, block1H);
pdf.setFontSize(11).setFont('helvetica', 'bold').setTextColor(31, 122, 76);
pdf.text('GeoConfront', PANEL_X + PANEL_W / 2, cursorY + 8, { align: 'center' });
pdf.setFontSize(8).setFont('helvetica', 'normal').setTextColor(80,80,80);
pdf.text('Análise de Confrontantes', PANEL_X + PANEL_W / 2, cursorY + 12.5, { align: 'center' });
pdf.setDrawColor(180,180,180).line(PANEL_X + 3, cursorY + 16, PANEL_X + PANEL_W - 3, cursorY + 16);
pdf.setFontSize(9).setFont('helvetica', 'bold').setTextColor(0,0,0);
const titleLines = pdf.splitTextToSize(opts.title, PANEL_W - 6);
pdf.text(titleLines, PANEL_X + PANEL_W / 2, cursorY + 22, { align: 'center', baseline: 'top' });
cursorY += block1H;

const block2H = 40;
pdf.rect(PANEL_X, cursorY, PANEL_W, block2H);
pdf.setFontSize(9).setFont('helvetica', 'bold').setTextColor(0,0,0);
pdf.text('Informações Cartográficas', PANEL_X + PANEL_W / 2, cursorY + 5, { align: 'center' });
pdf.setFontSize(7.5).setFont('helvetica', 'normal');
const center = fakeMap.getCenter();
const utmZone = utmZoneFromLng(center.lng);
const scale = estimateMapScale(fakeMap);
const infoLines = [
  'Projeção Universal Transversa de Mercator',
  `UTM Zona ${utmZone} — Hemisfério Sul`,
  'Datum Horizontal: SIRGAS 2000',
  `Escala 1:${scale.toLocaleString('pt-BR')}`,
];
infoLines.forEach((line, i) => {
  pdf.text(line, PANEL_X + PANEL_W / 2, cursorY + 11 + i * 4, { align: 'center' });
});
pdf.setFontSize(8).setFont('helvetica', 'bold');
pdf.text('Escala Gráfica', PANEL_X + PANEL_W / 2, cursorY + 30, { align: 'center' });
drawGraphicScale(pdf, PANEL_X + 5, cursorY + 35, PANEL_W - 10, scale);
cursorY += block2H;

const block3H = 70;
pdf.rect(PANEL_X, cursorY, PANEL_W, block3H);
pdf.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0,0,0);
pdf.text('LEGENDA', PANEL_X + PANEL_W / 2, cursorY + 6, { align: 'center' });
const legend = [
  { color: [180, 30, 35], label: 'Imóveis Certificados — SIGEF' },
  { color: [255, 255, 255], outline: true, border: [255, 90, 30], label: 'Imóveis — CAR (SICAR)' },
  { color: [255, 255, 255], hatch: true, border: [60, 180, 75], label: 'Imóvel em Estudo' },
  { color: [120, 120, 120], label: 'Imóveis Confrontantes Cadastrados' },
];
legend.forEach((item, i) => {
  const y = cursorY + 12 + i * 9;
  const sx = PANEL_X + 5;
  if (item.hatch) {
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(item.border[0], item.border[1], item.border[2]).setLineWidth(0.6);
    pdf.rect(sx, y, 8, 5, 'FD');
    pdf.setDrawColor(60, 180, 75).setLineWidth(0.3);
    pdf.line(sx, y + 5, sx + 5, y);
    pdf.line(sx + 1.5, y + 5, sx + 6.5, y);
    pdf.line(sx + 3, y + 5, sx + 8, y);
  } else if (item.outline) {
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(item.border[0], item.border[1], item.border[2]).setLineWidth(0.8);
    pdf.rect(sx, y, 8, 5, 'FD');
  } else {
    pdf.setFillColor(item.color[0], item.color[1], item.color[2]);
    pdf.setDrawColor(0,0,0).setLineWidth(0.2);
    pdf.rect(sx, y, 8, 5, 'FD');
  }
  pdf.setFontSize(8).setFont('helvetica', 'normal').setTextColor(0,0,0);
  pdf.text(item.label, sx + 11, y + 3.7);
});
cursorY += block3H;

const block4H = PAGE_H - MARGIN - cursorY;
pdf.rect(PANEL_X, cursorY, PANEL_W, block4H);
if (opts.responsibleName) {
  pdf.setDrawColor(80,80,80).setLineWidth(0.3);
  pdf.line(PANEL_X + 6, cursorY + block4H - 14, PANEL_X + PANEL_W - 6, cursorY + block4H - 14);
  pdf.setFontSize(8).setFont('helvetica', 'normal').setTextColor(0,0,0);
  pdf.text(opts.responsibleName, PANEL_X + PANEL_W / 2, cursorY + block4H - 10, { align: 'center' });
  if (opts.responsibleRegistry) {
    pdf.setFontSize(7);
    pdf.text(opts.responsibleRegistry, PANEL_X + PANEL_W / 2, cursorY + block4H - 6.5, { align: 'center' });
  }
}
if (opts.producedBy) {
  pdf.setFontSize(6.5).setTextColor(120,120,120);
  pdf.text(`Produzido por: ${opts.producedBy}`, PANEL_X + PANEL_W / 2, cursorY + block4H - 2, { align: 'center' });
}

const buf = pdf.output('arraybuffer');
fs.writeFileSync('/tmp/qa-export.pdf', Buffer.from(buf));
console.log('Wrote /tmp/qa-export.pdf');
console.log(`Estimated scale: 1:${scale}, UTM zone: ${utmZone}`);
console.log(`MAP_W=${MAP_W}, MAP_H=${MAP_H}, PANEL_X=${PANEL_X}, PANEL_W=${PANEL_W}`);
console.log(`Block1=${block1H}, Block2=${block2H}, Block3=${block3H}, Block4=${block4H}`);
