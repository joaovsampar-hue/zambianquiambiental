// SIGEF do Acervo Fundiário do INCRA — via edge function `sigef-incra-proxy`.
//
// Por que NÃO usamos mais o ArcGIS Online INCRA_SIGEF_Imoveis_Certificados:
// aquele FeatureServer é a camada "Buffer 5 km" (só áreas indígenas/quilombolas/
// assentamentos). Mariápolis/SP e a maioria das regiões agrícolas retornam vazio.
//
// O Acervo Fundiário (i3geo/MapServer do INCRA) tem cobertura nacional completa,
// um tema por UF: `certificada_sigef_particular_<uf>`. Mas o servidor é
// HTTP-only, sem CORS e instável — por isso passamos por uma edge function que
// adiciona HTTPS+CORS e retry, e exibimos como tile WMS no Leaflet.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

/** URL base do nosso proxy WMS — o Leaflet anexa os params do GetMap. */
export const SIGEF_PROXY_WMS = `${SUPABASE_URL}/functions/v1/sigef-incra-proxy`;

/** UFs com tema disponível no acervo fundiário (todas as 27). */
export const SIGEF_UFS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA',
  'PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
] as const;
export type SigefUF = typeof SIGEF_UFS[number];

/**
 * O cliente envia um alias amigável (`sigef_particular_sp`) que o proxy converte
 * para o tema real `certificada_sigef_particular_sp` do MapServer do INCRA.
 */
export const sigefLayerForUF = (uf: string) => `sigef_particular_${uf.toLowerCase()}`;

export interface SigefInfo {
  parcela_codigo: string | null;
  nome_area: string | null;
  rt: string | null;
  art: string | null;
  situacao: string | null;
  status: string | null;
  codigo_imovel: string | null;
  matricula: string | null;
  data_aprovacao: string | null;
  data_registro: string | null;
}

/**
 * O i3Geo do INCRA devolve GetFeatureInfo no formato `text/html` (uma tabela).
 * Extraímos os campos por regex — o MapServer usa um template fixo, então o
 * HTML é estável (linhas `<tr><th>campo</th><td>valor</td></tr>`).
 *
 * Quando não há feature no ponto, o HTML vem vazio ou só com cabeçalhos.
 */
export function parseSigefInfoHtml(html: string): SigefInfo | null {
  if (!html || !html.trim()) return null;

  // O MapServer pode devolver várias estruturas — tentamos algumas:
  // 1. <tr><th>campo</th><td>valor</td></tr>
  // 2. campo = valor (texto plano)
  const get = (field: string): string | null => {
    // formato html
    const reHtml = new RegExp(
      `<th[^>]*>\\s*${field}\\s*</th>\\s*<td[^>]*>\\s*([^<]+?)\\s*</td>`,
      'i',
    );
    const mh = html.match(reHtml);
    if (mh) return mh[1].trim() || null;
    // formato campo: valor (label)
    const reTxt = new RegExp(`${field}\\s*[:=]\\s*([^\\n<]+)`, 'i');
    const mt = html.match(reTxt);
    return mt ? mt[1].trim() || null : null;
  };

  const info: SigefInfo = {
    parcela_codigo: get('parcela_codigo') ?? get('codigo_parcela'),
    nome_area: get('nome_area') ?? get('nome'),
    rt: get('rt') ?? get('responsavel_tecnico'),
    art: get('art') ?? get('numero_art'),
    situacao: get('situacao_informada') ?? get('situacao'),
    status: get('status'),
    codigo_imovel: get('codigo_imovel'),
    matricula: get('registro_matricula') ?? get('matricula'),
    data_aprovacao: get('data_aprovacao'),
    data_registro: get('registro_data') ?? get('data_registro'),
  };

  // Considera "achou" se ao menos um identificador veio.
  const found = info.parcela_codigo || info.matricula || info.codigo_imovel || info.nome_area;
  return found ? info : null;
}
