// Proxy CORS+HTTPS para o Acervo Fundiário do INCRA (i3Geo/MapServer).
//
// O servidor original (http://acervofundiario.incra.gov.br/i3geo/ogc.php) tem três
// problemas para uso direto no browser:
//   1. HTTP-only (mixed content quando o app roda em HTTPS)
//   2. Sem CORS (Access-Control-Allow-Origin ausente)
//   3. Latência alta + timeouts ocasionais (servidor i3Geo do governo)
//
// Esta edge function repassa requisições WMS (GetMap / GetFeatureInfo) para a
// camada SIGEF particular da UF correta, devolvendo PNG ou JSON com CORS aberto.
//
// ## Como o cliente usa
// - Tiles WMS: `${FUNCTION_URL}/wms?LAYERS=...&BBOX=...&...` — Leaflet monta a URL.
// - GetFeatureInfo: mesma rota, com REQUEST=GetFeatureInfo e INFO_FORMAT=text/html.
//
// ## Tema por UF
// O acervo fundiário expõe um tema por UF para SIGEF particular:
//   `certificada_sigef_particular_<uf>` (ex.: certificada_sigef_particular_sp).
// O cliente envia `LAYERS=sigef_particular_sp` (alias amigável) e nós convertemos.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const INCRA_BASE = 'http://acervofundiario.incra.gov.br/i3geo/ogc.php';

// UFs suportadas — todas têm tema certificada_sigef_particular_<uf> no acervo.
const VALID_UFS = new Set([
  'ac','al','am','ap','ba','ce','df','es','go','ma','mg','ms','mt','pa',
  'pb','pe','pi','pr','rj','rn','ro','rr','rs','sc','se','sp','to',
]);

/** Resolve o tema do acervo fundiário a partir do alias enviado pelo cliente. */
function resolveTema(layers: string): string | null {
  const lower = layers.toLowerCase().trim();
  // Aceita tanto o nome completo quanto o atalho `sigef_particular_<uf>`.
  const matchAlias = lower.match(/^sigef_particular_([a-z]{2})$/);
  const matchFull = lower.match(/^certificada_sigef_particular_([a-z]{2})$/);
  const uf = matchAlias?.[1] ?? matchFull?.[1];
  if (!uf || !VALID_UFS.has(uf)) return null;
  return `certificada_sigef_particular_${uf}`;
}

/**
 * Reconstrói os search params trocando `LAYERS`/`QUERY_LAYERS` pelo tema real
 * e adicionando o `tema=` no path (o i3Geo usa esse param fora do WMS para
 * selecionar o mapfile).
 */
function buildUpstreamUrl(reqUrl: URL): { url: string; tema: string } | null {
  const params = new URLSearchParams();
  let layersParam = '';
  for (const [k, v] of reqUrl.searchParams) {
    const key = k.toUpperCase();
    if (key === 'LAYERS' || key === 'QUERY_LAYERS') layersParam = v;
    params.set(key, v);
  }
  const tema = resolveTema(layersParam);
  if (!tema) return null;
  // O i3Geo precisa do `tema` no path E o `LAYERS` no WMS aponta para o tema real.
  params.set('LAYERS', tema);
  if (params.has('QUERY_LAYERS')) params.set('QUERY_LAYERS', tema);
  // Garante service=WMS por default (Leaflet sempre envia, mas defensivo).
  if (!params.has('SERVICE')) params.set('SERVICE', 'WMS');
  return {
    url: `${INCRA_BASE}?tema=${tema}&${params.toString()}`,
    tema,
  };
}

/** Fetch com timeout — o INCRA pode levar 20-40s em queries pesadas. */
async function fetchUpstreamOnce(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Fetch com retry + backoff exponencial (2s/4s/8s) quando o INCRA dá timeout
 * (AbortError) ou status 5xx. O acervo fundiário é instável e cai com frequência;
 * sem retry geramos muitos falso-negativos no popup ("Sem certificação SIGEF").
 *
 * Total worst-case: 3 tentativas × 35s timeout + 2s+4s = ~111s. O Leaflet aceita
 * tiles lentos sem cancelar — o ganho em recall vale a latência ocasional.
 */
async function fetchUpstream(url: string, timeoutMs = 35000): Promise<Response> {
  const delays = [2000, 4000, 8000]; // backoff entre tentativas (3 tentativas no total)
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetchUpstreamOnce(url, timeoutMs);
      // Retry só em 5xx (erros do upstream). 4xx = pedido inválido, não adianta repetir.
      if (resp.status >= 500 && attempt < 2) {
        console.warn(`[sigef-incra-proxy] upstream ${resp.status}, retry ${attempt + 1}/3`);
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      return resp;
    } catch (e) {
      lastErr = e;
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[sigef-incra-proxy] tentativa ${attempt + 1}/3 falhou (${isAbort ? 'timeout' : msg})`);
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
    }
  }
  throw lastErr ?? new Error('All retries failed');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  // Aceita qualquer subpath (`/wms`, `/`, etc.) — o cliente usa um path fixo, mas
  // toda a lógica está nos query params do WMS.
  const upstream = buildUpstreamUrl(url);

  if (!upstream) {
    return new Response(
      JSON.stringify({
        error: 'Invalid LAYERS param',
        hint: 'Use LAYERS=sigef_particular_<uf> (ex.: sigef_particular_sp)',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const upstreamResp = await fetchUpstream(upstream.url);
    const contentType = upstreamResp.headers.get('content-type') ?? 'application/octet-stream';
    const body = await upstreamResp.arrayBuffer();
    // Cache agressivo (24h) para respostas válidas — o SIGEF muda devagar (semanas/meses)
    // e o servidor do INCRA é instável: vale guardar bastante para reduzir hits no upstream.
    // stale-while-revalidate dobra a janela útil servindo cache enquanto revalida em background.
    const isOk = upstreamResp.status >= 200 && upstreamResp.status < 300;
    let cache: string;
    if (!isOk) {
      cache = 'no-store'; // erros não devem ser cacheados
    } else if (contentType.startsWith('image/')) {
      cache = 'public, max-age=86400, stale-while-revalidate=86400'; // 24h + 24h SWR
    } else {
      cache = 'public, max-age=86400, stale-while-revalidate=43200'; // 24h + 12h SWR (HTML/XML)
    }
    return new Response(body, {
      status: upstreamResp.status,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
        'Cache-Control': cache,
        'X-Upstream-Tema': upstream.tema,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[sigef-incra-proxy] upstream error após retries', upstream.url, msg);
    return new Response(
      JSON.stringify({ error: 'Upstream INCRA timeout/erro após 3 tentativas', detail: msg }),
      {
        status: 502,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      },
    );
  }
});
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[sigef-incra-proxy] upstream error', upstream.url, msg);
    return new Response(
      JSON.stringify({ error: 'Upstream INCRA timeout/erro', detail: msg }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
