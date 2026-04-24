import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `REGRA ABSOLUTA: Extraia dados EXCLUSIVAMENTE do documento PDF fornecido nesta requisição. Jamais utilize nomes, CPFs, RGs ou qualquer dado de análises anteriores, exemplos ou sessões anteriores. Se um dado não estiver claramente visível no documento, retorne null. Nunca infira, complete ou invente dados.

Você é um especialista em análise de matrículas de imóveis rurais brasileiros para fins de georreferenciamento SIGEF.

Analise o texto/imagem da matrícula fornecida e extraia TODOS os dados disponíveis no seguinte formato JSON:

{
  "identification": {
    "denomination": "denominação do imóvel",
    "registration_number": "número da matrícula",
    "ccir": "número do CCIR",
    "municipality": "município",
    "state": "UF",
    "county": "comarca",
    "registry_office": "cartório de registro",
    "total_area": "área total em hectares",
    "ideal_fraction": "fração ideal se houver"
  },
  "owners": [
    {
      "name": "nome completo",
      "cpf_cnpj": "CPF ou CNPJ",
      "rg": "RG e órgão emissor",
      "birth_date": "data de nascimento",
      "nationality": "nacionalidade",
      "marital_status": "estado civil",
      "marriage_regime": "regime de casamento",
      "share_percentage": "participação %",
      "address": "endereço",
      "role": "proprietario_pleno | nu_proprietario | usufrutuario | nu_proprietario_e_proprietario_pleno",
      "share_nu_propriedade": "percentual %",
      "share_propriedade_plena": "percentual %",
      "share_usufruto": "percentual %",
      "usufruto_tipo": "vitalicio | temporario",
      "usufruto_termino": "data se temporário",
      "usufruto_ato": "ex: R.3-M/6.420",
      "spouse": { "name": "", "cpf": "", "rg": "" }
    }
  ],
  "usufructuaries": [
    { "name": "", "cpf": "", "type": "", "legal_basis": "" }
  ],
  "boundaries": {
    "roteiro": "transcrição completa do roteiro perimétrico/descrição de confrontações conforme consta na matrícula, em texto único corrido",
    "north": "descrição",
    "south": "descrição",
    "east": "descrição",
    "west": "descrição"
  },
  "encumbrances": {
    "fiduciary_alienation": "detalhes",
    "seizure": "detalhes",
    "mortgage": "detalhes",
    "easements": "detalhes",
    "legal_reserve": "detalhes da ARL",
    "app": "detalhes da APP",
    "special_clauses": "inalienabilidade, impenhorabilidade, etc",
    "general_notes": "outras observações"
  },
  "transfers": [
    { "date": "", "seller": "", "buyer": "", "value": "", "nature": "" }
  ]
}

Também retorne uma lista de alertas no formato:
{
  "alerts": [
    { "severity": "critical|warning|info", "message": "descrição do alerta" }
  ]
}

Regras de alerta:
- "critical": CPF/CNPJ ausente de proprietário, ônus ativos (alienação fiduciária, penhora), usufrutuário sem anuência
- "warning": CCIR não localizado, divergência de área, regime de casamento não especificado
- "info": observações gerais, dados complementares

Retorne SOMENTE JSON válido, sem markdown ou texto adicional. Se um campo não for encontrado, use string vazia "".

=== INSTRUÇÕES ADICIONAIS PARA MATRÍCULAS DIFÍCEIS ===

INSTRUÇÃO 1 — MARCA D'ÁGUA E PROTEÇÃO DE CÓPIA:
Ignore textos de marca d'água. Concentre-se no conteúdo jurídico.

INSTRUÇÃO 2 — DOCUMENTOS ANTIGOS E DATILOGRAFADOS:
Normalize abreviações. Preserve números e áreas EXATAMENTE.

INSTRUÇÃO 2B — DENOMINAÇÃO ATUAL DO IMÓVEL:
Use a denominação mais recente (averbação final).

INSTRUÇÃO 3 — IDENTIFICAÇÃO DO PROPRIETÁRIO ATUAL:
Retorne apenas os últimos adquirentes sem transmissão posterior.

INSTRUÇÃO 3B e 10 — VERIFICAÇÃO OBRIGATÓRIA DE FALECIMENTO:
Se houver averbação de óbito de um proprietário, REMOVA-O de owners e gere alerta crítico.

INSTRUÇÃO 5 — REGIME DE CASAMENTO:
Antes de 26/12/1977 = Comunhão Universal.
Após = Comunhão Parcial (padrão).

INSTRUÇÃO 11 — USUFRUTO:
Usufrutuários DEVEM estar em owners com role: 'usufrutuario'.

INSTRUÇÃO 15 — VIUVEZ:
Se houver menção a viuvez ou óbito do cônjuge, o estado civil DEVE ser 'viúvo(a)'.

INSTRUÇÃO 20 — ATOS ANULADOS:
Atos anulados/cancelados NÃO geram proprietários atuais.
`;

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
    const { data: userData, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !userData?.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const userId = userData.user.id;
    const { analysisId, pdfPath, imagePaths } = await req.json();

    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
      return new Response(JSON.stringify({ error: "imagePaths é obrigatório." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Security check
    for (const p of imagePaths) {
      if (!p.startsWith(`${userId}/`)) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Download images and convert to base64 for Native Gemini API
    const imageParts = [];
    for (const path of imagePaths) {
      const { data: blob, error: dErr } = await supabase.storage.from("matriculas").download(path);
      if (dErr) throw dErr;
      
      const buffer = await blob.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      imageParts.push({ inlineData: { mimeType: "image/jpeg", data: base64 } });
    }

    const callGemini = async (model: string, userPrompt: string) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${googleApiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: userPrompt }, ...imageParts] }],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: { temperature: 0, responseMimeType: "application/json" }
        })
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${err}`);
      }
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    };

    let content = await callGemini("gemini-1.5-flash", "Analise esta matrícula de imóvel rural. Extraia todos os dados no formato JSON especificado.");
    
    const tryParse = (raw: string) => {
      try {
        const m = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/\{[\s\S]*\}/);
        return JSON.parse(m ? (m[1] || m[0]) : raw);
      } catch { return null; }
    };

    let parsed = tryParse(content);
    
    // Retry if empty
    if (!parsed || !parsed.owners || parsed.owners.length === 0) {
      console.log("Empty response, retrying with gemini-1.5-pro...");
      content = await callGemini("gemini-1.5-pro", "A análise anterior falhou. Tente novamente com atenção máxima. Extraia todos os dados no formato JSON especificado.");
      parsed = tryParse(content);
    }

    if (!parsed) parsed = { identification: {}, owners: [], boundaries: {}, encumbrances: {}, transfers: [] };

    return new Response(JSON.stringify({ extracted_data: parsed, alerts: parsed.alerts ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("process-matricula error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
