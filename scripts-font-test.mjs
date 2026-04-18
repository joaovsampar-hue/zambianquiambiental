import { jsPDF } from 'jspdf';
import fs from 'fs';
const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
// teste 1: bold + center
pdf.setFontSize(11).setFont('helvetica', 'bold');
pdf.text('GeoConfront', 100, 20, { align: 'center' });
// teste 2: bold + left
pdf.text('GeoConfront', 100, 30);
// teste 3: regular + center
pdf.setFont('helvetica', 'normal');
pdf.text('GeoConfront normal', 100, 40, { align: 'center' });
// teste 4: bold + center + accents
pdf.setFont('helvetica', 'bold');
pdf.text('Informações Cartográficas', 100, 50, { align: 'center' });
pdf.text('Análise Prévia — Sítio', 100, 60, { align: 'center' });
fs.writeFileSync('/tmp/font-test.pdf', Buffer.from(pdf.output('arraybuffer')));
