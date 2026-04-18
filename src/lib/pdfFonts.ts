// Carrega a fonte Inter (regular + bold) via fetch no jsDelivr e a registra no
// jsPDF. Resolve dois problemas do helvetica padrão:
//   1. Acentos portugueses ficam com letter-spacing fantasma ("Análise" vira
//      "Aná lise" no Chrome PDF Viewer).
//   2. Não tem variantes opentype, então kerning fica grosseiro.
//
// Cache em memória — só baixa 1x por sessão.

import type jsPDF from 'jspdf';

const INTER_REGULAR_URL = 'https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.16/files/inter-latin-400-normal.woff';
const INTER_BOLD_URL = 'https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.16/files/inter-latin-700-normal.woff';

// jsPDF aceita TTF, não WOFF. Vamos usar a versão TTF do mesmo pacote.
const INTER_REGULAR_TTF = 'https://cdn.jsdelivr.net/gh/rsms/inter@v4.0/docs/font-files/Inter-Regular.ttf';
const INTER_BOLD_TTF = 'https://cdn.jsdelivr.net/gh/rsms/inter@v4.0/docs/font-files/Inter-Bold.ttf';
const INTER_ITALIC_TTF = 'https://cdn.jsdelivr.net/gh/rsms/inter@v4.0/docs/font-files/Inter-Italic.ttf';

let cache: { regular: string; bold: string; italic: string } | null = null;
let inflight: Promise<typeof cache> | null = null;

async function fetchAsBase64(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Falha baixando fonte: ${url}`);
  const buf = await resp.arrayBuffer();
  // ArrayBuffer → base64 em chunks (evita estouro de stack do String.fromCharCode com arrays grandes).
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

async function loadAll() {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const [regular, bold, italic] = await Promise.all([
      fetchAsBase64(INTER_REGULAR_TTF),
      fetchAsBase64(INTER_BOLD_TTF),
      fetchAsBase64(INTER_ITALIC_TTF),
    ]);
    cache = { regular, bold, italic };
    return cache;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/**
 * Embute Inter no documento jsPDF. Após registro:
 *   pdf.setFont('Inter', 'normal'|'bold'|'italic')
 * funciona normalmente. Se o download falhar, faz fallback silencioso para
 * helvetica — a exportação continua funcionando, só com kerning ruim.
 */
export async function embedInterFont(pdf: jsPDF): Promise<boolean> {
  try {
    const { regular, bold, italic } = (await loadAll())!;
    pdf.addFileToVFS('Inter-Regular.ttf', regular);
    pdf.addFont('Inter-Regular.ttf', 'Inter', 'normal');
    pdf.addFileToVFS('Inter-Bold.ttf', bold);
    pdf.addFont('Inter-Bold.ttf', 'Inter', 'bold');
    pdf.addFileToVFS('Inter-Italic.ttf', italic);
    pdf.addFont('Inter-Italic.ttf', 'Inter', 'italic');
    return true;
  } catch (err) {
    console.warn('[pdfFonts] Inter não disponível, usando helvetica:', err);
    return false;
  }
}
