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
 * INFO_FORMAT que o MapServer i3Geo do INCRA aceita.
 * `text/html` NÃO é suportado ("Unsupported INFO_FORMAT value (text/html)").
 * `application/vnd.ogc.gml` é o formato nativo (GML 2.x).
 */
export const SIGEF_INFO_FORMAT = 'application/vnd.ogc.gml';

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
 * Parse da resposta GetFeatureInfo do MapServer i3Geo do INCRA.
 * Aceita GML (formato nativo), HTML (legado) e texto plano. O parser usa regex
 * tolerante a namespace (ms:, sigef:, gml:, etc.) porque o prefixo varia.
 */
export function parseSigefInfoHtml(payload: string): SigefInfo | null {
  if (!payload || !payload.trim()) return null;

  // Resposta de erro do servidor — nunca é uma feature válida.
  if (/ServiceException/i.test(payload)) return null;

  const get = (field: string): string | null => {
    // GML/XML: <ns:field>valor</ns:field> ou <field>valor</field>
    const reXml = new RegExp(
      `<(?:[a-z0-9_]+:)?${field}\\b[^>]*>\\s*([^<]+?)\\s*</(?:[a-z0-9_]+:)?${field}>`,
      'i',
    );
    const mx = payload.match(reXml);
    if (mx) return mx[1].trim() || null;
    // HTML legado: <th>field</th><td>valor</td>
    const reHtml = new RegExp(
      `<th[^>]*>\\s*${field}\\s*</th>\\s*<td[^>]*>\\s*([^<]+?)\\s*</td>`,
      'i',
    );
    const mh = payload.match(reHtml);
    if (mh) return mh[1].trim() || null;
    // Texto plano: campo: valor
    const reTxt = new RegExp(`\\b${field}\\s*[:=]\\s*([^\\n<]+)`, 'i');
    const mt = payload.match(reTxt);
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

  const found = info.parcela_codigo || info.matricula || info.codigo_imovel || info.nome_area;
  if (found) return info;

  // Fallback: featureMember não-vazio (há parcela mas campos com nomes diferentes).
  if (/<(?:gml:)?featureMember[^>]*>\s*<[^>/]+>/i.test(payload)) return info;
  return null;
}
