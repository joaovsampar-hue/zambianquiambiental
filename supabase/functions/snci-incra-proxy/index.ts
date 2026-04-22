// Proxy CORS+HTTPS para o Acervo Fundiário do INCRA (i3Geo/MapServer) - SNCI (1ª Norma).
//
// O servidor original (http://acervofundiario.incra.gov.br/i3geo/ogc.php) é HTTP-only.
// Esta edge function repassa requisições WMS para as camadas SNCI (privado/público),
// adicionando HTTPS+CORS e retries para contornar instabilidades.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const INCRA_BASE = 'http://acervofundiario.incra.gov.br/i3geo/ogc.php';

// UFs suportadas pelo acervo fundiário.
const VALID_UFS = new Set([
  'ac','al','am','ap','ba','ce','df','es','go','ma','mg','ms','mt','pa',
  'pb','pe','pi','pr','rj','rn','ro','rr','rs','sc','se','sp','to',
]);

/** Valida se o tema solicitado segue o padrão SNCI do INCRA. */
function resolveTema(layers: string): string | null {
  const lower = layers.toLowerCase().trim();
  // Aceita imoveiscertificados_privado_<uf> ou imoveiscertificados_publico_<uf>
  const match = lower.match(/^imoveiscertificados_(privado|publico)_([a-z]{2})$/);
  const uf = match?.[2];
  if (!uf || !VALID_UFS.has(uf)) return null;
  return lower;
}

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
  if (!params.has('SERVICE')) params.set('SERVICE', 'WMS');

  return {
    url: `${INCRA_BASE}?tema=${tema}&${params.toString()}`,
    tema,
  };
}

async function fetchUpstreamOnce(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchUpstream(url: string, timeoutMs = 35000): Promise<Response> {
  const delays = [2000, 4000, 8000];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetchUpstreamOnce(url, timeoutMs);
      if (resp.status >= 500 && attempt < 2) {
        console.warn(`[snci-incra-proxy] upstream ${resp.status}, retry ${attempt + 1}/3`);
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      return resp;
    } catch (e) {
      lastErr = e;
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[snci-incra-proxy] tentativa ${attempt + 1}/3 falhou (${isAbort ? 'timeout' : msg})`);
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
  const upstream = buildUpstreamUrl(url);

  if (!upstream) {
    return new Response(
      JSON.stringify({
        error: 'Invalid LAYERS param',
        hint: 'Use LAYERS=imoveiscertificados_privado_<uf> (ex.: imoveiscertificados_privado_sp)',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const upstreamResp = await fetchUpstream(upstream.url);
    const contentType = upstreamResp.headers.get('content-type') ?? 'application/octet-stream';
    const body = await upstreamResp.arrayBuffer();

    const isOk = upstreamResp.status >= 200 && upstreamResp.status < 300;
    let cache: string;
    if (!isOk) {
      cache = 'no-store';
    } else if (contentType.startsWith('image/')) {
      cache = 'public, max-age=86400, stale-while-revalidate=86400';
    } else {
      cache = 'public, max-age=86400, stale-while-revalidate=43200';
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
    console.error('[snci-incra-proxy] upstream error após retries', upstream.url, msg);
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
