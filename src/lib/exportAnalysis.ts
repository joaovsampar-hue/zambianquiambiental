import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  Header, Footer, PageNumber,
} from 'docx';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface NeighborRow {
  denomination?: string | null;
  registration_number?: string | null;
  ccir?: string | null;
  municipality?: string | null;
  state?: string | null;
  car_number?: string | null;
  owners?: Array<{
    name?: string;
    cpf_cnpj?: string;
    marital_status?: string;
    marriage_regime?: string;
    vigencia_lei_divorcio?: string;
    spouse?: { name?: string };
  }>;
}

interface AnalysisData {
  extractedData: any;
  alerts: any[];
  propertyName: string;
  clientName: string;
  version: number;
  createdAt: string;
  /** F2 — confrontantes carregados de process_neighbors. */
  neighbors?: NeighborRow[];
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

// =============================================================================
// F1 — Render encumbrances que vêm como ARRAY de objetos (M5/R8).
// O bug original: o campo era serializado direto como string ("[object Object]").
// Solução: detectar arrays e formatar legivelmente; fallback para texto livre.
// =============================================================================

function isArrayOfObjects(v: any): v is any[] {
  return Array.isArray(v) && v.length > 0 && v.some(x => x && typeof x === 'object');
}

/** Devolve linhas de tabela (Word) para um conjunto de itens de ônus. */
function encumbranceRowsWord(items: any[], statusKey: string): TableRow[] {
  const header = new TableRow({
    children: ['#', 'Ato origem', 'Status', 'Cancelamento', 'Descrição'].map(h =>
      new TableCell({
        borders: cellBorders,
        shading: { fill: 'E8F5E9', type: ShadingType.CLEAR },
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18, font: 'Arial' })] })],
      })
    ),
  });
  const dataRows = items.map((it, i) => {
    const status = it?.[statusKey] ?? it?.status_hipoteca ?? it?.status_fiduciaria ?? it?.status_penhora ?? 'indefinida';
    const isCanceled = status === 'cancelada';
    const desc = (it?.descricao ?? '').toString();
    return new TableRow({
      children: [
        String(i + 1),
        it?.ato_origem ?? '—',
        isCanceled ? `${status} (quitada)` : status,
        it?.ato_cancelamento ?? '—',
        desc,
      ].map((txt, idx) =>
        new TableCell({
          borders: cellBorders,
          margins: { top: 50, bottom: 50, left: 80, right: 80 },
          width: idx === 4 ? { size: 4000, type: WidthType.DXA } : undefined,
          children: [new Paragraph({ children: [new TextRun({ text: String(txt || '—'), size: 18, font: 'Arial' })] })],
        })
      ),
    });
  });
  return [header, ...dataRows];
}

/** String legível do array de ônus para PDF (jsPDF autoTable). */
function encumbranceTableForPdf(doc: jsPDF, startY: number, items: any[], statusKey: string): number {
  const body = items.map((it, i) => {
    const status = it?.[statusKey] ?? it?.status_hipoteca ?? it?.status_fiduciaria ?? it?.status_penhora ?? 'indefinida';
    const isCanceled = status === 'cancelada';
    return [
      String(i + 1),
      it?.ato_origem ?? '—',
      isCanceled ? `${status} (quitada)` : status,
      it?.ato_cancelamento ?? '—',
      (it?.descricao ?? '—').toString(),
    ];
  });
  autoTable(doc, {
    startY,
    head: [['#', 'Ato origem', 'Status', 'Cancelamento', 'Descrição']],
    body,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
    headStyles: { fillColor: [232, 245, 233], textColor: [30, 94, 50], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 22 },
      2: { cellWidth: 22 },
      3: { cellWidth: 22 },
      4: { cellWidth: 'auto' },
    },
    margin: { left: 14, right: 14 },
  });
  return (doc as any).lastAutoTable.finalY + 4;
}

/** Coerção segura para texto livre (campos não-array). */
function safeText(v: any): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v || '—';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.map((i: any) => safeText(i)).join('; ');
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

const LIMIT_NON_NAMES = new Set([
  'acima', 'abaixo', 'no', 'na', 'nos', 'nas', 'em', 'pelo', 'pela',
  'rumo', 'sentido', 'direção', 'distância', 'metros', 'conforme',
  'seguindo', 'margem', 'linha', 'reta', 'sinuosas', 'sempre',
  'encontrar', 'deflexão', 'ponto', 'marco', 'vértice',
  // Termos jurídicos/cartorários que não são nomes de limites
  'registro', 'ofício', 'judicial', 'respectivo', 'distrito',
  'civil', 'comarca', 'cartório', 'averbação', 'matrícula',
  'certidão', 'imóvel', 'proprietário', 'confrontante',
  'nascente', 'poente', 'oriente', 'ocidente',
  'referido', 'mencionado', 'descrito', 'denominado',
  'este', 'esse', 'aquele', 'mesmo', 'próprio',
]);

const roleLabel = (o: any): string => {
  switch (o.role) {
    case 'nu_proprietario': return '[ Nu-Proprietário ]';
    case 'usufrutuario': return '[ Usufrutuário ]';
    case 'nu_proprietario_e_proprietario_pleno':
      return `[ Nu-Proprietário (${o.share_nu_propriedade ?? ''}) + Proprietário Pleno (${o.share_propriedade_plena ?? ''}) ]`;
    default: return '';
  }
};

function extractLimits(roteiro: string): Array<{ tipo: string; nome: string }> {
  if (!roteiro) return [];
  const results: Array<{ tipo: string; nome: string }> = [];
  const seen = new Set();

  const patterns = [
    { tipo: 'Córrego',         regex: /c[oó]rrego\s+((?:do\s+|da\s+|dos\s+|das\s+|de\s+)?[^\s,;.()\n]+(?:\s+[^\s,;.()\n]+){0,3})/gi },
    { tipo: 'Ribeirão',        regex: /ribei[rã]o\s+((?:do\s+|da\s+|dos\s+|das\s+|de\s+)?[^\s,;.()\n]+(?:\s+[^\s,;.()\n]+){0,3})/gi },
    { tipo: 'Rio',             regex: /\brio\s+((?:do\s+|da\s+|dos\s+|das\s+|de\s+)?[^\s,;.()\n]+(?:\s+[^\s,;.()\n]+){0,3})/gi },
    { tipo: 'Riacho',          regex: /riacho\s+((?:do\s+|da\s+|dos\s+|das\s+|de\s+)?[^\s,;.()\n]+(?:\s+[^\s,;.()\n]+){0,3})/gi },
    { tipo: 'Estrada Municipal',regex: /estrada\s+municipal\s+([^\s,;.()\n]+(?:\s+[^\s,;.()\n]+){0,5})/gi },
    { tipo: 'Estrada Estadual', regex: /estrada\s+estadual\s+([^\s,;.()\n]+(?:\s+[^\s,;.()\n]+){0,5})/gi },
    { tipo: 'Rodovia',         regex: /rodovia\s+([^\s,;.()\n]+(?:\s+[^\s,;.()\n]+){0,5})/gi },
    { tipo: 'Estrada',         regex: /\bestrada\s+(?!municipal|estadual|de\s+ferro)([^\s,;.()\n]+(?:\s+[^\s,;.()\n]+){0,5})/gi },
  ];

  for (const { tipo, regex } of patterns) {
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(roteiro)) !== null) {
      const raw = match[1].trim().replace(/\s+/g, ' ');
      // Pega a primeira palavra significativa para verificar blacklist
      const firstWord = raw.split(/\s+/)[0].toLowerCase().replace(/[^a-zà-ú]/g, '');
      if (LIMIT_NON_NAMES.has(firstWord)) continue;
      if (raw.length < 3 || raw.length > 60) continue;
      // Rejeita nomes que contenham palavras de contexto jurídico
      const lowerRaw = raw.toLowerCase();
      if (/\b(registro|ofício|judicial|cartório|certidão|comarca|civil|respectivo|distrito)\b/.test(lowerRaw)) continue;
      // Rejeita se a segunda palavra for articulador (indica continuação de frase, não nome)
      const words = raw.split(/\s+/);
      if (words.length >= 2) {
        const secondWord = words[1].toLowerCase().replace(/[^a-zà-ú]/g, '');
        if (['do', 'da', 'de', 'dos', 'das'].includes(secondWord) && words.length === 2) {
          // "Rio do" sem complemento — ignora
          continue;
        }
      }
      // Limita ao nome principal (até encontrar preposição de direção)
      const nome = raw
        .split(/\s+(?:e\s+segue|e\s+daí|e\s+segue\s+em|no\s+rumo|em\s+linha|na\s+dist|até\s+|conf|,\s*e\s+)/i)[0]
        .trim();
      const key = `${tipo}:${nome.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ tipo, nome });
      }
    }
  }
  return results;
}

export async function exportToWord(data: AnalysisData) {
  const ed = data.extractedData ?? {};
  const id = ed.identification ?? {};
  const owners = ed.owners ?? [];
  const enc = ed.encumbrances ?? {};
  const bounds = ed.boundaries ?? {};

  const neighbors = data.neighbors ?? [];

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
      const ownerTitle = (o: any, idx: number): string => {
        if (o.role === 'usufrutuario') return `Usufrutuário ${idx + 1}`;
        if (o.role === 'nu_proprietario') return `Proprietário ${idx + 1} — Nu-Proprietário`;
        return `Proprietário ${idx + 1}`;
      };

      children.push(new Paragraph({ 
        spacing: { before: 150 }, 
        children: [new TextRun({ text: ownerTitle(o, i), bold: true, size: 22, font: 'Arial' })] 
      }));

      const label = roleLabel(o);
      if (label) {
        children.push(new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: label, bold: true, size: 18, font: 'Arial', color: '1565C0' })],
        }));
      }
      // F3 — Regime + Lei 6.515/77 no MESMO campo
      const regime = (o.marriage_regime ?? '').toString().trim();
      const vig = o.vigencia_lei_divorcio;
      const regimeFull = (() => {
        const label =
          vig === 'antes_da_vigencia_6515' || vig === 'antes_da_vigencia' ? 'anterior à Lei 6.515/77' :
          vig === 'vigencia_6515' || vig === 'apos_vigencia' ? 'Lei 6.515/77' :
          vig === 'vigencia_cc2002' ? 'CC/2002 (Lei 10.406)' : '';
        return label && regime ? `${regime} (${label})` : regime;
      })();

      const ownerRows: [string, string][] = [
        ['Nome', o.name],
        ['CPF/CNPJ', o.cpf_cnpj],
        ['RG', o.rg],
        ['Estado Civil', o.marital_status],
        ['Regime de Casamento', regimeFull],
        ['Participação (%)', o.share_percentage],
        ['Nacionalidade', o.nationality],
      ];

      if (o.role === 'nu_proprietario_e_proprietario_pleno') {
        ownerRows.push(['Nua-propriedade (%)', o.share_nu_propriedade || '—']);
        ownerRows.push(['Propriedade plena (%)', o.share_propriedade_plena || '—']);
      }
      if (o.role === 'usufrutuario') {
        ownerRows.push(['Usufruto (%)', o.share_usufruto || o.share_percentage || '—']);
        ownerRows.push(['Tipo de usufruto', o.usufruto_tipo === 'vitalicio' ? 'Vitalício' : (o.usufruto_tipo || '—')]);
        ownerRows.push(['Ato constitutivo', o.usufruto_ato || '—']);
      }

      children.push(new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [3500, 5860],
        rows: labelValueRows(ownerRows),
      }));
      if (o.spouse?.name || o.spouse?.cpf) {
        const spouseLabel = o.spouse?.share_percentage ? 'Cônjuge (co-proprietário)' : 'Cônjuge';
        children.push(new Paragraph({
          spacing: { before: 100 },
          children: [new TextRun({ text: spouseLabel, bold: true, size: 20, font: 'Arial', color: '555555' })],
        }));
        const spouseRows: [string, string][] = [
          ['Nome', o.spouse.name ?? ''],
          ['CPF', o.spouse.cpf ?? ''],
          ['RG', o.spouse.rg ?? ''],
        ];
        if (o.spouse.share_percentage) spouseRows.push(['Participação (%)', String(o.spouse.share_percentage)]);
        children.push(new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [3500, 5860],
          rows: labelValueRows(spouseRows),
        }));
      }
    });
  }

  // F1 — Encumbrances: iterar arrays
  children.push(sectionHeading('3. Ônus e Restrições'));

  const encSections: Array<[string, any, string]> = [
    ['Alienação Fiduciária', enc.fiduciary_alienation, 'status_fiduciaria'],
    ['Penhora', enc.seizure, 'status_penhora'],
    ['Hipoteca', enc.mortgage, 'status_hipoteca'],
  ];
  for (const [label, value, statusKey] of encSections) {
    children.push(new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: label, bold: true, size: 22, font: 'Arial' })] }));
    if (isArrayOfObjects(value)) {
      children.push(new Table({
        width: { size: 9360, type: WidthType.DXA },
        rows: encumbranceRowsWord(value, statusKey),
      }));
    } else if (Array.isArray(value) && value.length === 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: 'Nenhum registrado', italics: true, size: 20, font: 'Arial', color: '888888' })] }));
    } else {
      children.push(new Paragraph({ children: [new TextRun({ text: safeText(value), size: 20, font: 'Arial' })] }));
    }
  }

  // Outros campos textuais
  children.push(new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [3500, 5860],
    rows: labelValueRows([
      ['Servidões', safeText(enc.easements)],
      ['Reserva Legal (ARL)', safeText(enc.legal_reserve)],
      ['APP', safeText(enc.app)],
      ['Cláusulas Especiais', safeText(enc.special_clauses)],
      ['Observações', safeText(enc.general_notes)],
    ]),
  }));

  // Boundaries (rumos)
  const roteiroWord = (bounds.roteiro ?? '').toString();
  const limitesWord = extractLimits(roteiroWord);
  if (limitesWord.length > 0) {
    children.push(sectionHeading('4. Limites Hídricos e Viários'));
    const headerRow = new TableRow({
      children: ['Tipo de limite', 'Nome'].map(h =>
        new TableCell({
          borders: cellBorders,
          shading: { fill: 'E8F5E9', type: ShadingType.CLEAR },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20, font: 'Arial' })] })],
        })
      ),
    });
    const dataRows = limitesWord.map(l => new TableRow({
      children: [l.tipo, l.nome].map(txt =>
        new TableCell({
          borders: cellBorders,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({ children: [new TextRun({ text: txt, size: 20, font: 'Arial' })] })],
        })
      ),
    }));
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [3500, 5860],
      rows: [headerRow, ...dataRows],
    }));
  }

  // F2 — Confrontantes cadastrados (process_neighbors)
  children.push(sectionHeading('5. Confrontantes'));
  if (neighbors.length === 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Nenhum confrontante cadastrado', italics: true, size: 20, font: 'Arial', color: '888888' })],
    }));
  } else {
    neighbors.forEach((n: NeighborRow, idx: number) => {
      // Cabeçalho do confrontante
      children.push(new Paragraph({
        spacing: { before: 200, after: 80 },
        children: [new TextRun({ text: `Confrontante ${idx + 1}`, bold: true, size: 22, font: 'Arial', color: '1B5E20' })],
      }));

      // Identificação do imóvel confrontante
      const munuf = [n.municipality, n.state].filter(Boolean).join('/') || '—';
      children.push(new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [3500, 5860],
        rows: labelValueRows([
          ['Denominação', n.denomination],
          ['Nº Matrícula', n.registration_number],
          ['CCIR', n.ccir],
          ['Município/UF', munuf],
        ]),
      }));

      // Proprietários do confrontante
      const ownersList = n.owners ?? [];
      if (ownersList.length > 0) {
        children.push(new Paragraph({
          spacing: { before: 120, after: 60 },
          children: [new TextRun({ text: 'Proprietários', bold: true, size: 20, font: 'Arial', color: '2E7D32' })],
        }));
        ownersList.forEach((o: any, oi: number) => {
          children.push(new Paragraph({
            spacing: { before: 80 },
            children: [new TextRun({ text: `Proprietário ${oi + 1}`, bold: true, size: 20, font: 'Arial' })],
          }));
          const label = roleLabel(o);
          if (label) {
            children.push(new Paragraph({
              spacing: { after: 60 },
              children: [new TextRun({ text: label, bold: true, size: 18, font: 'Arial', color: '1565C0' })],
            }));
          }
          const regime = (o.marriage_regime ?? '').toString().trim();
          const vig = o.vigencia_lei_divorcio;
          const regimeFull = (() => {
            const label =
              vig === 'antes_da_vigencia_6515' || vig === 'antes_da_vigencia' ? 'anterior à Lei 6.515/77' :
              vig === 'vigencia_6515' || vig === 'apos_vigencia' ? 'Lei 6.515/77' :
              vig === 'vigencia_cc2002' ? 'CC/2002 (Lei 10.406)' : '';
            return label && regime ? `${regime} (${label})` : (regime || '—');
          })();
          children.push(new Table({
            width: { size: 9360, type: WidthType.DXA },
            columnWidths: [3500, 5860],
            rows: labelValueRows(([
              ['Nome', o.name],
              ['CPF/CNPJ', o.cpf_cnpj],
              ['RG', o.rg],
              ['Estado Civil', o.marital_status],
              ['Regime de Casamento', regimeFull],
              ['Participação (%)', o.share_percentage],
              ...(o.role === 'nu_proprietario_e_proprietario_pleno' ? [
                ['Nua-propriedade (%)', o.share_nu_propriedade],
                ['Propriedade plena (%)', o.share_propriedade_plena]
              ] : []),
              ...(o.role === 'usufrutuario' ? [
                ['Usufruto', `${o.share_usufruto} (${o.usufruto_tipo === 'vitalicio' ? 'vitalício' : 'temporário'})`]
              ] : []),
              ...(o.usufruto_ato ? [['Ato de usufruto', o.usufruto_ato]] : []),
            ] as [string, string][])),
          }));
          if (o.spouse?.name || o.spouse?.cpf) {
            const spouseLabel = o.spouse?.share_percentage ? 'Cônjuge (co-proprietário)' : 'Cônjuge';
            children.push(new Paragraph({
              spacing: { before: 80 },
              children: [new TextRun({ text: spouseLabel, bold: true, size: 20, font: 'Arial', color: '555555' })],
            }));
            const spouseRows: [string, string][] = [
              ['Nome', o.spouse.name ?? ''],
              ['CPF', o.spouse.cpf ?? ''],
              ['RG', o.spouse.rg ?? ''],
            ];
            if (o.spouse.share_percentage) spouseRows.push(['Participação (%)', String(o.spouse.share_percentage)]);
            children.push(new Table({
              width: { size: 9360, type: WidthType.DXA },
              columnWidths: [3500, 5860],
              rows: labelValueRows(spouseRows),
            }));
          }
        });
      }
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
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
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

  const neighbors = data.neighbors ?? [];

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
      const label = roleLabel(o);
      if (label) {
        doc.setFontSize(8);
        doc.setTextColor(21, 101, 192);
        doc.text(label, 14, y);
        y += 4;
      }
      
      const ownerTitle = (owner: any, idx: number): string => {
        if (owner.role === 'usufrutuario') return `Usufrutuário ${idx + 1}`;
        if (owner.role === 'nu_proprietario') return `Proprietário ${idx + 1} — Nu-Proprietário`;
        return `Proprietário ${idx + 1}`;
      };

      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      doc.text(ownerTitle(o, i), 14, y);
      y += 2;

      // F3 — Regime + lei no mesmo campo
      const regime = (o.marriage_regime ?? '').toString().trim();
      const vig = o.vigencia_lei_divorcio;
      const regimeFull = (() => {
        const label =
          vig === 'antes_da_vigencia_6515' || vig === 'antes_da_vigencia' ? 'anterior à Lei 6.515/77' :
          vig === 'vigencia_6515' || vig === 'apos_vigencia' ? 'Lei 6.515/77' :
          vig === 'vigencia_cc2002' ? 'CC/2002 (Lei 10.406)' : '';
        return label && regime ? `${regime} (${label})` : (regime || '—');
      })();

      const ownerBody: [string, string][] = [
        ['Nome', o.name || '—'],
        ['CPF/CNPJ', o.cpf_cnpj || '—'],
        ['RG', o.rg || '—'],
        ['Estado Civil', o.marital_status || '—'],
        ['Regime de Casamento', regimeFull],
        ['Participação (%)', o.share_percentage || '—'],
        ['Nacionalidade', o.nationality || '—'],
      ];

      if (o.role === 'nu_proprietario_e_proprietario_pleno') {
        ownerBody.push(['Nua-propriedade (%)', o.share_nu_propriedade || '—']);
        ownerBody.push(['Propriedade plena (%)', o.share_propriedade_plena || '—']);
      }
      if (o.role === 'usufrutuario') {
        ownerBody.push(['Usufruto (%)', o.share_usufruto || o.share_percentage || '—']);
        ownerBody.push(['Tipo de usufruto', o.usufruto_tipo === 'vitalicio' ? 'Vitalício' : (o.usufruto_tipo || '—')]);
        ownerBody.push(['Ato constitutivo', o.usufruto_ato || '—']);
      }

      autoTable(doc, {
        startY: y,
        head: [],
        body: ownerBody,
        theme: 'grid',
        styles: { fontSize: 9 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45, fillColor: [232, 245, 233] } },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 4;

      if (o.spouse?.name || o.spouse?.cpf) {
        if (y > 260) { doc.addPage(); y = 20; }
        const spouseLabel = o.spouse?.share_percentage ? 'Cônjuge (co-proprietário)' : 'Cônjuge';
        doc.setFontSize(10);
        doc.setTextColor(80, 80, 80);
        doc.text(spouseLabel, 14, y);
        y += 2;
        doc.setTextColor(0, 0, 0);
        const spouseBody: string[][] = [
          ['Nome', o.spouse.name || '—'],
          ['CPF', o.spouse.cpf || '—'],
          ['RG', o.spouse.rg || '—'],
        ];
        if (o.spouse.share_percentage) spouseBody.push(['Participação (%)', String(o.spouse.share_percentage)]);
        autoTable(doc, {
          startY: y,
          head: [],
          body: spouseBody,
          theme: 'grid',
          styles: { fontSize: 9 },
          columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45, fillColor: [240, 240, 240] } },
          margin: { left: 14, right: 14 },
        });
        y = (doc as any).lastAutoTable.finalY + 4;
      }
    });
  }

  // F1 — Encumbrances: array → tabela; vazio → "Nenhum registrado"; texto → texto
  addSection('3. Ônus e Restrições');
  const encSections: Array<[string, any, string]> = [
    ['Alienação Fiduciária', enc.fiduciary_alienation, 'status_fiduciaria'],
    ['Penhora', enc.seizure, 'status_penhora'],
    ['Hipoteca', enc.mortgage, 'status_hipoteca'],
  ];
  for (const [label, value, statusKey] of encSections) {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFontSize(11);
    doc.setTextColor(...green);
    doc.text(label, 14, y);
    y += 5;
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    if (isArrayOfObjects(value)) {
      y = encumbranceTableForPdf(doc, y, value, statusKey);
    } else if (Array.isArray(value) && value.length === 0) {
      doc.setTextColor(120, 120, 120);
      doc.text('Nenhum registrado', 14, y);
      doc.setTextColor(0, 0, 0);
      y += 6;
    } else {
      const txt = safeText(value);
      const lines = doc.splitTextToSize(txt, pageW - 28);
      doc.text(lines, 14, y);
      y += lines.length * 4 + 2;
    }
  }

  // Outros campos textuais (servidões, ARL, APP, etc)
  if (y > 250) { doc.addPage(); y = 20; }
  autoTable(doc, {
    startY: y,
    head: [],
    body: [
      ['Servidões', safeText(enc.easements)],
      ['Reserva Legal (ARL)', safeText(enc.legal_reserve)],
      ['APP', safeText(enc.app)],
      ['Cláusulas Especiais', safeText(enc.special_clauses)],
      ['Observações', safeText(enc.general_notes)],
    ],
    theme: 'grid',
    styles: { fontSize: 9 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45, fillColor: [232, 245, 233] } },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  // Boundaries (rumos)
  const roteiroPdf = (bounds.roteiro ?? '').toString();
  const limitesPdf = extractLimits(roteiroPdf);
  if (limitesPdf.length > 0) {
    addSection('4. Limites Hídricos e Viários');
    autoTable(doc, {
      startY: y,
      head: [['Tipo de limite', 'Nome']],
      body: limitesPdf.map(l => [l.tipo, l.nome]),
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [232, 245, 233], textColor: [30, 94, 50], fontStyle: 'bold' },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45, fillColor: [245, 245, 245] } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // F2 — Confrontantes cadastrados
  addSection('5. Confrontantes');
  if (neighbors.length === 0) {
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(9);
    doc.text('Nenhum confrontante cadastrado', 14, y);
    doc.setTextColor(0, 0, 0);
    y += 6;
  } else {
    neighbors.forEach((n: NeighborRow, idx: number) => {
      if (y > 250) { doc.addPage(); y = 20; }

      // Cabeçalho do confrontante
      doc.setFontSize(11);
      doc.setTextColor(...green);
      doc.text(`Confrontante ${idx + 1}`, 14, y);
      y += 6;
      doc.setTextColor(0, 0, 0);

      // Identificação do imóvel
      const munuf = [n.municipality, n.state].filter(Boolean).join('/') || '—';
      autoTable(doc, {
        startY: y,
        head: [],
        body: [
          ['Denominação', n.denomination || '—'],
          ['Nº Matrícula', n.registration_number || '—'],
          ['CCIR', n.ccir || '—'],
          ['Município/UF', munuf],
        ],
        theme: 'grid',
        styles: { fontSize: 9 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45, fillColor: [232, 245, 233] } },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 4;

      // Proprietários
      const ownersList = n.owners ?? [];
      if (ownersList.length > 0) {
        ownersList.forEach((o: any, oi: number) => {
          if (y > 250) { doc.addPage(); y = 20; }
          const label = roleLabel(o);
          if (label) {
            doc.setFontSize(8);
            doc.setTextColor(21, 101, 192);
            doc.text(label, 14, y);
            y += 4;
          }
          doc.setFontSize(10);
          doc.setTextColor(60, 60, 60);
          doc.text(`Proprietário ${oi + 1}`, 14, y);
          y += 3;
          doc.setTextColor(0, 0, 0);

          const regime = (o.marriage_regime ?? '').toString().trim();
          const vig = o.vigencia_lei_divorcio;
          const regimeFull = (() => {
            const label =
              vig === 'antes_da_vigencia_6515' || vig === 'antes_da_vigencia' ? 'anterior à Lei 6.515/77' :
              vig === 'vigencia_6515' || vig === 'apos_vigencia' ? 'Lei 6.515/77' :
              vig === 'vigencia_cc2002' ? 'CC/2002 (Lei 10.406)' : '';
            return label && regime ? `${regime} (${label})` : (regime || '—');
          })();

          autoTable(doc, {
            startY: y,
            head: [],
            body: [
              ['Nome', o.name || '—'],
              ['CPF/CNPJ', o.cpf_cnpj || '—'],
              ['RG', o.rg || '—'],
              ['Estado Civil', o.marital_status || '—'],
              ['Regime de Casamento', regimeFull],
              ['Participação (%)', o.share_percentage || '—'],
              ...(o.role === 'nu_proprietario_e_proprietario_pleno' ? [
                ['Nua-propriedade (%)', o.share_nu_propriedade || '—'],
                ['Propriedade plena (%)', o.share_propriedade_plena || '—']
              ] : []),
              ...(o.role === 'usufrutuario' ? [
                ['Usufruto', `${o.share_usufruto || '—'} (${o.usufruto_tipo === 'vitalicio' ? 'vitalício' : 'temporário'})`]
              ] : []),
              ...(o.usufruto_ato ? [['Ato de usufruto', o.usufruto_ato]] : []),
            ],
            theme: 'grid',
            styles: { fontSize: 9 },
            columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45, fillColor: [232, 245, 233] } },
            margin: { left: 14, right: 14 },
          });
          y = (doc as any).lastAutoTable.finalY + 3;

          if (o.spouse?.name || o.spouse?.cpf) {
            if (y > 250) { doc.addPage(); y = 20; }
            const spouseLabel = o.spouse?.share_percentage ? 'Cônjuge (co-proprietário)' : 'Cônjuge';
            doc.setFontSize(9);
            doc.setTextColor(80, 80, 80);
            doc.text(spouseLabel, 14, y);
            y += 3;
            doc.setTextColor(0, 0, 0);
            const spouseBody: string[][] = [
              ['Nome', o.spouse.name || '—'],
              ['CPF', o.spouse.cpf || '—'],
              ['RG', o.spouse.rg || '—'],
            ];
            if (o.spouse.share_percentage) spouseBody.push(['Participação (%)', String(o.spouse.share_percentage)]);
            autoTable(doc, {
              startY: y,
              head: [],
              body: spouseBody,
              theme: 'grid',
              styles: { fontSize: 9 },
              columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45, fillColor: [240, 240, 240] } },
              margin: { left: 14, right: 14 },
            });
            y = (doc as any).lastAutoTable.finalY + 3;
          }
        });
      }

      y += 4; // espaço entre confrontantes
    });
  }

  // Alerts
  if (data.alerts.length > 0) {
    addSection('6. Alertas');
    data.alerts.forEach((a: any) => {
      if (y > 260) { doc.addPage(); y = 20; }
      const sev = a.severity === 'critical' ? '[CRÍTICO]' : a.severity === 'warning' ? '[ATENÇÃO]' : '[INFO]';
      const fullText = `${sev} ${a.message ?? ''}`;
      doc.setFontSize(9);
      // Cor por severidade
      if (a.severity === 'critical') doc.setTextColor(180, 0, 0);
      else if (a.severity === 'warning') doc.setTextColor(180, 100, 0);
      else doc.setTextColor(30, 80, 160);
      const lines = doc.splitTextToSize(fullText, pageW - 28);
      doc.text(lines, 14, y);
      doc.setTextColor(0, 0, 0);
      y += lines.length * 4.5 + 3;
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
