import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Você é um especialista em análise de matrículas de imóveis rurais brasileiros para fins de georreferenciamento SIGEF.

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
      "spouse": { "name": "", "cpf": "", "rg": "" }
    }
  ],
  "usufructuaries": [
    { "name": "", "cpf": "", "type": "", "legal_basis": "" }
  ],
  "boundaries": {
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

Retorne SOMENTE JSON válido, sem markdown ou texto adicional. Se um campo não for encontrado, use string vazia "".`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { analysisId, pdfPath } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    if (!lovableApiKey) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Download PDF from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("matriculas")
      .download(pdfPath);
    if (downloadError) throw downloadError;

    // Convert PDF to base64 for vision model (chunked to avoid stack overflow)
    const arrayBuffer = await fileData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
    }
    const base64 = btoa(binary);

    // Send to Lovable AI Gateway with vision
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analise esta matrícula de imóvel rural e extraia todos os dados no formato JSON especificado. Identifique todos os alertas relevantes.",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:application/pdf;base64,${base64}`,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Gateway error:", response.status, errorText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns minutos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA insuficientes." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content ?? "";

    // Parse JSON from AI response
    let parsed;
    try {
      // Try to extract JSON from possible markdown code blocks
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error("Failed to parse AI response:", content);
      parsed = { identification: {}, owners: [{}], boundaries: {}, encumbrances: {}, transfers: [{}] };
    }

    const extracted_data = {
      identification: parsed.identification ?? {},
      owners: parsed.owners ?? [{}],
      usufructuaries: parsed.usufructuaries ?? [],
      boundaries: parsed.boundaries ?? {},
      encumbrances: parsed.encumbrances ?? {},
      transfers: parsed.transfers ?? [{}],
    };

    const alerts = parsed.alerts ?? [];

    return new Response(JSON.stringify({ extracted_data, alerts }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("process-matricula error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
