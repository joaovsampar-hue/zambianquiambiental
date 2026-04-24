import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Você está analisando a matrícula de um IMÓVEL CONFRONTANTE. Seu objetivo é extrair APENAS proprietário(s) atual(is) e identificação do imóvel. NÃO extraia ônus ou alertas.

CATEGORIA 1 — PROPRIETÁRIO(S) ATUAL(IS):
Identifique os últimos adquirentes. Pesquise CPF/RG em atos anteriores se faltar no último.

CATEGORIA 2 — IDENTIFICAÇÃO DO IMÓVEL:
Denominação, matrícula, CCIR, município, UF, comarca, cartório, área (ha).

Retorne EXATAMENTE este schema JSON:
{
  "denominacao_imovel": string | null,
  "matricula_numero": string | null,
  "ccir": string | null,
  "ccir_fonte": "ccir" | "registro_incra" | "nao_encontrado",
  "municipio": string | null,
  "uf": string | null,
  "comarca": string | null,
  "cartorio": string | null,
  "area_hectares": number | null,
  "owners": [{
    "nome": string | null,
    "cpf": string | null,
    "rg": string | null,
    "rg_orgao": string | null,
    "data_nascimento": string | null,
    "estado_civil": string | null,
    "regime_casamento": string | null,
    "conjuge_nome": string | null,
    "conjuge_cpf": string | null,
    "share_percentage": string | null,
    "verificar_titularidade": boolean,
    "fonte_dados_documentais": "averbacao_final" | "averbacao_anterior" | "nao_encontrado",
    "role": "proprietario_pleno" | "nu_proprietario" | "usufrutuario" | "nu_proprietario_e_proprietario_pleno"
  }],
  "campos_incertos": string[]
}
`;

const tryParseJson = (content: string): any => {
  try {
    const m = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? (m[1] || m[0]) : content);
  } catch { return null; }
};

async function callNativeGemini(apiKey: string, model: string, systemPrompt: string, userPrompt: string, pdfPart: any): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userPrompt }, pdfPart] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { temperature: 0, responseMimeType: "application/json" }
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`GOOGLE_API_ERROR_${response.status}_${err}`);
  }
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const googleApiKey = Deno.env.get("GOOGLE_API_KEY");
    if (!googleApiKey) throw new Error("GOOGLE_API_KEY not configured");

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData } = await authClient.auth.getUser(token);
    if (!userData?.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const userId = userData.user.id;
    const { pdfPath } = await req.json();
    if (!pdfPath || !pdfPath.startsWith(`${userId}/`)) throw new Error("Acesso negado ao arquivo");

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: fileData, error: dErr } = await supabase.storage.from("matriculas").download(pdfPath);
    if (dErr) throw dErr;

    const buffer = await fileData.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    const pdfPart = { inlineData: { mimeType: "application/pdf", data: base64 } };

    let content = await callNativeGemini(googleApiKey, "gemini-1.5-flash", SYSTEM_PROMPT, "Analise esta matrícula de imóvel confrontante.", pdfPart);
    let parsed = tryParseJson(content);

    if (!parsed || (parsed.owners && parsed.owners.length === 0)) {
      console.log("Retry with Pro...");
      content = await callNativeGemini(googleApiKey, "gemini-1.5-pro", SYSTEM_PROMPT, "A análise anterior falhou. Tente novamente com atenção máxima.", pdfPart);
      parsed = tryParseJson(content);
    }

    if (!parsed) parsed = { owners: [] };

    return new Response(JSON.stringify(parsed), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("analyze-neighbor-matricula error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
