// SNCI (Sistema Nacional de Certificação de Imóveis) — 1ª Norma de Georreferenciamento do INCRA.
// Via Cloudflare Worker (proxy CORS + TLS para o Acervo Fundiário do INCRA).

/** URL base do nosso proxy WMS para SNCI no Cloudflare. */
export const SNCI_PROXY_WMS = 'https://geodoc-snci-proxy.joaov-sampar.workers.dev';

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
