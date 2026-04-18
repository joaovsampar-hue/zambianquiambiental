/**
 * Exporta a lista de confrontantes de um processo como planilha .xlsx.
 *
 * Layout (conforme solicitado):
 *  - Linha 1: nome do cliente (mesclada visualmente — usamos negrito + tamanho maior)
 *  - Linha 3: cabeçalho — Posição | Nome do proprietário | Matrícula | Telefone | CAR | Cartório
 *  - Demais linhas: um confrontante por linha
 */
import * as XLSX from 'xlsx';

export interface NeighborExportRow {
  positions: string[] | null;
  full_name: string | null;
  registration_number: string | null;
  phones: Array<{ number?: string; label?: string }> | null;
  car_number: string | null;
  registry_office: string | null;
}

const formatPhones = (phones: NeighborExportRow['phones']): string => {
  if (!phones || phones.length === 0) return '';
  return phones
    .map(p => (p.label ? `${p.label}: ${p.number}` : p.number))
    .filter(Boolean)
    .join(' / ');
};

export function exportNeighborsToExcel(opts: {
  clientName: string;
  processNumber?: string;
  neighbors: NeighborExportRow[];
}): void {
  const { clientName, processNumber, neighbors } = opts;

  // AOA = "array of arrays" — controle total sobre layout.
  const aoa: (string | number)[][] = [];
  aoa.push([`Cliente: ${clientName}`]);
  if (processNumber) aoa.push([`Processo: ${processNumber}`]);
  aoa.push([`Confrontantes: ${neighbors.length}`]);
  aoa.push([]); // linha em branco
  aoa.push([
    'Posição',
    'Nome do proprietário',
    'Matrícula',
    'Telefone',
    'CAR',
    'Cartório',
  ]);

  for (const n of neighbors) {
    aoa.push([
      (n.positions ?? []).join(', ') || '—',
      n.full_name ?? '',
      n.registration_number ?? '',
      formatPhones(n.phones),
      n.car_number ?? '',
      n.registry_office ?? '',
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Larguras razoáveis pra não cortar conteúdo no Excel/Google Sheets.
  ws['!cols'] = [
    { wch: 18 }, // posição
    { wch: 35 }, // nome do proprietário
    { wch: 16 }, // matrícula
    { wch: 22 }, // telefone
    { wch: 42 }, // CAR
    { wch: 28 }, // cartório
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Confrontantes');

  const safeClient = clientName.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40) || 'cliente';
  const ts = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `confrontantes_${safeClient}_${ts}.xlsx`);
}
