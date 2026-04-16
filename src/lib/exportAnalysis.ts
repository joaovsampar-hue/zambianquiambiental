import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  Header, Footer, PageNumber,
} from 'docx';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface AnalysisData {
  extractedData: any;
  alerts: any[];
  propertyName: string;
  clientName: string;
  version: number;
  createdAt: string;
}

const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

function labelValueRows(pairs: [string, string][]) {
  return pairs.map(([label, value]) =>
    new TableRow({
      children: [
        new TableCell({
          borders: cellBorders,
          width: { size: 3500, type: WidthType.DXA },
          shading: { fill: 'E8F5E9', type: ShadingType.CLEAR },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, font: 'Arial' })] })],
        }),
        new TableCell({
          borders: cellBorders,
          width: { size: 5860, type: WidthType.DXA },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({ children: [new TextRun({ text: value || '—', size: 20, font: 'Arial' })] })],
        }),
      ],
    })
  );
}

function sectionHeading(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 150 },
    children: [new TextRun({ text, bold: true, size: 26, font: 'Arial', color: '2E7D32' })],
  });
}

export async function exportToWord(data: AnalysisData) {
  const ed = data.extractedData ?? {};
  const id = ed.identification ?? {};
  const owners = ed.owners ?? [];
  const enc = ed.encumbrances ?? {};
  const bounds = ed.boundaries ?? {};
  const transfers = ed.transfers ?? [];

  const children: any[] = [];

  // Title
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    children: [new TextRun({ text: 'Relatório de Análise Documental', bold: true, size: 36, font: 'Arial', color: '1B5E20' })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
    children: [new TextRun({ text: `${data.propertyName} — ${data.clientName} — Versão ${data.version}`, size: 22, font: 'Arial', color: '666666' })],
  }));

  // Identification
  children.push(sectionHeading('1. Identificação do Imóvel'));
  children.push(new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [3500, 5860],
    rows: labelValueRows([
      ['Denominação', id.denomination],
      ['Nº Matrícula', id.registration_number],
      ['CCIR', id.ccir],
      ['Área Total (ha)', id.total_area],
      ['Município', id.municipality],
      ['UF', id.state],
      ['Comarca', id.county],
      ['Cartório', id.registry_office],
      ['Fração Ideal', id.ideal_fraction],
    ]),
  }));

  // Owners
  if (owners.length > 0) {
    children.push(sectionHeading('2. Proprietários'));
    owners.forEach((o: any, i: number) => {
      children.push(new Paragraph({ spacing: { before: 150 }, children: [new TextRun({ text: `Proprietário ${i + 1}`, bold: true, size: 22, font: 'Arial' })] }));
      children.push(new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [3500, 5860],
        rows: labelValueRows([
          ['Nome', o.name],
          ['CPF/CNPJ', o.cpf_cnpj],
          ['RG', o.rg],
          ['Estado Civil', o.marital_status],
          ['Participação (%)', o.share_percentage],
          ['Nacionalidade', o.nationality],
        ]),
      }));
    });
  }

  // Encumbrances
  children.push(sectionHeading('3. Ônus e Restrições'));
  children.push(new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [3500, 5860],
    rows: labelValueRows([
      ['Alienação Fiduciária', enc.fiduciary_alienation],
      ['Penhora', enc.seizure],
      ['Hipoteca', enc.mortgage],
      ['Servidões', enc.easements],
      ['Reserva Legal (ARL)', enc.legal_reserve],
      ['APP', enc.app],
      ['Cláusulas Especiais', enc.special_clauses],
      ['Observações', enc.general_notes],
    ]),
  }));

  // Boundaries
  children.push(sectionHeading('4. Confrontantes'));
  children.push(new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [3500, 5860],
    rows: labelValueRows([
      ['Norte', bounds.north],
      ['Sul', bounds.south],
      ['Leste', bounds.east],
      ['Oeste', bounds.west],
    ]),
  }));

  // Transfers
  if (transfers.length > 0) {
    children.push(sectionHeading('5. Transmissões'));
    transfers.forEach((t: any, i: number) => {
      children.push(new Paragraph({ spacing: { before: 150 }, children: [new TextRun({ text: `Transmissão ${i + 1}`, bold: true, size: 22, font: 'Arial' })] }));
      children.push(new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [3500, 5860],
        rows: labelValueRows([
          ['Data', t.date],
          ['Natureza', t.nature],
          ['Vendedor', t.seller],
          ['Comprador', t.buyer],
          ['Valor', t.value],
        ]),
      }));
    });
  }

  // Alerts
  if (data.alerts.length > 0) {
    children.push(sectionHeading('6. Alertas'));
    data.alerts.forEach((a: any) => {
      const sev = a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟡' : '🔵';
      children.push(new Paragraph({
        spacing: { before: 60 },
        children: [new TextRun({ text: `${sev} ${a.message}`, size: 20, font: 'Arial' })],
      }));
    });
  }

  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'Arial', size: 20 } } },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: 'Zambianqui Ambiental — Geo Análise Documental', size: 16, font: 'Arial', color: '999999' })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: 'Página ', size: 16, font: 'Arial' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, font: 'Arial' })],
          })],
        }),
      },
      children,
    }],
  });

  const buffer = await Packer.toBlob(doc);
  saveAs(buffer, `Analise_${data.propertyName.replace(/\s+/g, '_')}_v${data.version}.docx`);
}

export function exportToPdf(data: AnalysisData) {
  const ed = data.extractedData ?? {};
  const id = ed.identification ?? {};
  const owners = ed.owners ?? [];
  const enc = ed.encumbrances ?? {};
  const bounds = ed.boundaries ?? {};
  const transfers = ed.transfers ?? [];

  const doc = new jsPDF();
  const green = [30, 94, 50] as [number, number, number];
  const pageW = doc.internal.pageSize.getWidth();
  let y = 20;

  const addSection = (title: string) => {
    if (y > 260) { doc.addPage(); y = 20; }
    y += 6;
    doc.setFontSize(13);
    doc.setTextColor(...green);
    doc.text(title, 14, y);
    y += 8;
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
  };

  // Title
  doc.setFontSize(18);
  doc.setTextColor(...green);
  doc.text('Relatório de Análise Documental', pageW / 2, y, { align: 'center' });
  y += 8;
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`${data.propertyName} — ${data.clientName} — Versão ${data.version}`, pageW / 2, y, { align: 'center' });
  y += 4;
  doc.setTextColor(100, 100, 100);
  doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, pageW / 2, y, { align: 'center' });
  y += 10;

  // Identification
  addSection('1. Identificação do Imóvel');
  autoTable(doc, {
    startY: y,
    head: [],
    body: [
      ['Denominação', id.denomination || '—'],
      ['Nº Matrícula', id.registration_number || '—'],
      ['CCIR', id.ccir || '—'],
      ['Área Total (ha)', id.total_area || '—'],
      ['Município', id.municipality || '—'],
      ['UF', id.state || '—'],
      ['Comarca', id.county || '—'],
      ['Cartório', id.registry_office || '—'],
      ['Fração Ideal', id.ideal_fraction || '—'],
    ],
    theme: 'grid',
    styles: { fontSize: 9 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45, fillColor: [232, 245, 233] } },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  // Owners
  if (owners.length > 0) {
    addSection('2. Proprietários');
    owners.forEach((o: any, i: number) => {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.setFontSize(10);
      doc.text(`Proprietário ${i + 1}`, 14, y);
      y += 2;
      autoTable(doc, {
        startY: y,
        head: [],
        body: [
          ['Nome', o.name || '—'],
          ['CPF/CNPJ', o.cpf_cnpj || '—'],
          ['RG', o.rg || '—'],
          ['Estado Civil', o.marital_status || '—'],
          ['Participação (%)', o.share_percentage || '—'],
          ['Nacionalidade', o.nationality || '—'],
        ],
        theme: 'grid',
        styles: { fontSize: 9 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45, fillColor: [232, 245, 233] } },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 4;
    });
  }

  // Encumbrances
  addSection('3. Ônus e Restrições');
  autoTable(doc, {
    startY: y,
    head: [],
    body: [
      ['Alienação Fiduciária', enc.fiduciary_alienation || '—'],
      ['Penhora', enc.seizure || '—'],
      ['Hipoteca', enc.mortgage || '—'],
      ['Servidões', enc.easements || '—'],
      ['Reserva Legal (ARL)', enc.legal_reserve || '—'],
      ['APP', enc.app || '—'],
      ['Cláusulas Especiais', enc.special_clauses || '—'],
      ['Observações', enc.general_notes || '—'],
    ],
    theme: 'grid',
    styles: { fontSize: 9 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45, fillColor: [232, 245, 233] } },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  // Boundaries
  addSection('4. Confrontantes');
  autoTable(doc, {
    startY: y,
    head: [],
    body: [
      ['Norte', bounds.north || '—'],
      ['Sul', bounds.south || '—'],
      ['Leste', bounds.east || '—'],
      ['Oeste', bounds.west || '—'],
    ],
    theme: 'grid',
    styles: { fontSize: 9 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45, fillColor: [232, 245, 233] } },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  // Transfers
  if (transfers.length > 0) {
    addSection('5. Transmissões');
    transfers.forEach((t: any, i: number) => {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.setFontSize(10);
      doc.text(`Transmissão ${i + 1}`, 14, y);
      y += 2;
      autoTable(doc, {
        startY: y,
        head: [],
        body: [
          ['Data', t.date || '—'],
          ['Natureza', t.nature || '—'],
          ['Vendedor', t.seller || '—'],
          ['Comprador', t.buyer || '—'],
          ['Valor', t.value || '—'],
        ],
        theme: 'grid',
        styles: { fontSize: 9 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45, fillColor: [232, 245, 233] } },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 4;
    });
  }

  // Alerts
  if (data.alerts.length > 0) {
    addSection('6. Alertas');
    data.alerts.forEach((a: any) => {
      if (y > 270) { doc.addPage(); y = 20; }
      const sev = a.severity === 'critical' ? '[CRÍTICO]' : a.severity === 'warning' ? '[ATENÇÃO]' : '[INFO]';
      doc.setFontSize(9);
      doc.text(`${sev} ${a.message}`, 14, y);
      y += 5;
    });
  }

  // Footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('Zambianqui Ambiental — Geo Análise Documental', 14, 290);
    doc.text(`Página ${i} de ${totalPages}`, pageW - 14, 290, { align: 'right' });
  }

  doc.save(`Analise_${data.propertyName.replace(/\s+/g, '_')}_v${data.version}.pdf`);
}
