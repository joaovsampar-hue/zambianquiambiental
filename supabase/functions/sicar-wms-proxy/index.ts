// Proxy para o WMS do SICAR — contorna CORS quando o servidor não envia headers permissivos.
// Encaminha qualquer query string para https://geoserver.car.gov.br/geoserver/sicar/wms
// e devolve a imagem de tile (PNG) com CORS aberto para o frontend.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SICAR_WMS = "https://geoserver.car.gov.br/geoserver/sicar/wms";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const upstream = `${SICAR_WMS}?${url.searchParams.toString()}`;

    const resp = await fetch(upstream, {
      headers: {
        // Alguns geoservers checam User-Agent
        "User-Agent": "GeoDocAnalyzer/1.0 (+https://lovable.dev)",
        Accept: "image/png,image/*;q=0.8,*/*;q=0.5",
      },
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error("SICAR upstream error:", resp.status, body.slice(0, 200));
      // Devolve PNG transparente 1x1 para não quebrar o mapa
      const transparent = Uint8Array.from(atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII="
      ), c => c.charCodeAt(0));
      return new Response(transparent, {
        headers: { ...corsHeaders, "Content-Type": "image/png", "Cache-Control": "no-cache" },
      });
    }

    const buf = await resp.arrayBuffer();
    const contentType = resp.headers.get("content-type") ?? "image/png";
    return new Response(buf, {
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    console.error("sicar-wms-proxy error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
