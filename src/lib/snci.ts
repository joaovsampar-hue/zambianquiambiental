// SNCI (Sistema Nacional de Certificação de Imóveis) — 1ª Norma de Georreferenciamento do INCRA.
// Via edge function `snci-incra-proxy`.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

/** URL base do nosso proxy WMS para SNCI. */
export const SNCI_PROXY_WMS = `${SUPABASE_URL}/functions/v1/snci-incra-proxy`;

/**
 * Layer name padrão (privado — cobre 95% dos casos de uso).
 * O proxy resolve para `imoveiscertificados_privado_<uf>` no acervo fundiário.
 */
export const snciLayerForUF = (uf: string) =>
  `imoveiscertificados_privado_${uf.toLowerCase()}`;

/**
 * Layer público para casos de imóveis públicos.
 * O proxy resolve para `imoveiscertificados_publico_<uf>` no acervo fundiário.
 */
export const snciPublicLayerForUF = (uf: string) =>
  `imoveiscertificados_publico_${uf.toLowerCase()}`;
