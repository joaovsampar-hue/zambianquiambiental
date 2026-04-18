// Edge function dedicada à análise de MATRÍCULA DE IMÓVEL CONFRONTANTE.
// Diferente de process-matricula (imóvel principal), este prompt foca em:
//  - Identificar SOMENTE o(s) proprietário(s) atual(is)
//  - Buscar dados documentais (CPF/RG) em averbações anteriores quando ausentes
//  - Não confundir o imóvel confrontante com o imóvel principal do processo
//
// Fluxo:
//  1) Primeira chamada à IA pedindo extração completa
//  2) Se proprietários atuais estiverem sem CPF E sem RG, faz retry focado pedindo
//     pesquisa em todas as averbações anteriores
//  3) Mescla resultados e retorna JSON estruturado
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Você está analisando a matrícula de um IMÓVEL CONFRONTANTE, NÃO do imóvel principal do processo. Seu objetivo é extrair três categorias com máxima precisão.

CATEGORIA 1 — PROPRIETÁRIO(S) ATUAL(IS):
Percorra TODOS os atos da matrícula em ordem cronológica. O proprietário atual é o último adquirente de cada fração SEM ato posterior de transmissão. Ignore transmitentes e adquirentes intermediários. Para cada proprietário atual, extraia: nome completo, CPF, RG e órgão emissor, estado civil, regime de casamento, dados do cônjuge.
Se o proprietário atual NÃO tiver CPF/RG mencionados na averbação final, PESQUISE EM TODAS AS AVERBAÇÕES ANTERIORES da MESMA matrícula — esses dados podem estar em atos anteriores de compra e venda, inventário ou formal de partilha. Sinalize \`fonte_dados_documentais: "averbacao_anterior"\` quando os dados vierem de atos que não sejam o último.
Em caso de dúvida sobre quem é o atual titular, retorne com flag \`verificar_titularidade: true\`.

CATEGORIA 2 — IDENTIFICAÇÃO DO IMÓVEL CONFRONTANTE:
Extraia: denominação oficial, número da matrícula, número do CCIR (procure em TODAS as páginas, inclusive cabeçalho e averbações), município e UF, comarca, cartório de registro, área total em hectares.

CATEGORIA 3 — ALERTAS:
Liste situações que possam afetar o georreferenciamento: ônus ativos (hipotecas, alienações fiduciárias, penhoras), usufrutos, cláusulas restritivas, indisponibilidades.

REGRAS CRÍTICAS:
- NUNCA confunda dados deste imóvel com o imóvel principal mencionado em referências cruzadas
- Ignore completamente textos de marca d'água
- Documentos antigos datilografados: normalize dados mas preserve números documentais EXATAMENTE
- Retorne SEMPRE JSON válido, mesmo que campos estejam null — NUNCA string vazia ou objeto incompleto

Retorne EXATAMENTE este schema (sem markdown, sem texto adicional):
{
  "denominacao_imovel": string | null,
  "matricula_numero": string | null,
  "ccir": string | null,
  "municipio": string | null,
  "uf": string | null,
  "comarca": string | null,
  "cartorio": string | null,
  "area_hectares": number | null,
  "proprietarios_atuais": [{
    "nome": string | null,
    "cpf": string | null,
    "rg": string | null,
    "rg_orgao": string | null,
    "data_nascimento": string | null,
    "estado_civil": string | null,
    "regime_casamento": string | null,
    "conjuge_nome": string | null,
    "conjuge_cpf": string | null,
    "fracao": string | null,
    "verificar_titularidade": boolean,
    "fonte_dados_documentais": "averbacao_final" | "averbacao_anterior" | "nao_encontrado"
  }],
  "alertas": string[],
  "campos_incertos": string[],
  "hipotecas": [{
    "descricao": string,
    "ato_origem": string | null,
    "status_hipoteca": "ativa" | "cancelada" | "indefinida",
    "ato_cancelamento": string | null
  }]
}

=== INSTRUÇÕES ADICIONAIS PARA MATRÍCULAS DIFÍCEIS ===

INSTRUÇÃO 1 — MARCA D'ÁGUA E PROTEÇÃO DE CÓPIA:
Este documento pode conter marcas d'água diagonais ou repetidas sobrepostas ao texto, com conteúdos como "VISUALIZAÇÃO ÚNICA", "CÓPIA NÃO AUTORIZADA", nome do cartório, data e hora de emissão, ou número de protocolo. Ignore completamente qualquer texto que faça parte da marca d'água — esses textos não são conteúdo jurídico da matrícula. Concentre-se exclusivamente no conteúdo da matrícula: cabeçalho, atos, averbações e transcrições. Se um campo de dado estiver parcialmente encoberto pela marca d'água, tente inferir o valor pelo contexto e indique esse campo com o sufixo "[inferido]" no valor retornado.

INSTRUÇÃO 2 — DOCUMENTOS ANTIGOS E DATILOGRAFADOS:
O documento pode ter sido produzido em máquina de escrever, com espaçamento irregular entre caracteres, abreviações de época (ex: Crs$ para cruzeiros, V.Exª, fls., R.I., Dr.ª, S/A), rasuras com correção sobreescrita, carimbos sobrepostos ao texto, numeração de folhas inserida no meio de frases e texto em caixa alta. Ao encontrar essas situações: normalize abreviações conhecidas para a forma completa; preserve números de documentos, matrículas e áreas EXATAMENTE como grafados — não corrija nem formate; para nomes em caixa alta, converta para formato nome próprio padrão; para valores monetários históricos, registre o valor e a moeda como constam sem conversão.

INSTRUÇÃO 3 — IDENTIFICAÇÃO DO PROPRIETÁRIO ATUAL EM MATRÍCULAS COM MUITAS TRANSMISSÕES:
A matrícula pode conter dezenas de atos ao longo dos anos. Para "proprietarios_atuais", retorne SOMENTE os últimos adquirentes de cada fração do imóvel — ou seja, aqueles que constam como compradores, donatários ou herdeiros em um ato sem que exista ato posterior transferindo a mesma fração a outra pessoa. Ignore todos os transmitentes e adquirentes intermediários. Se houver dúvida sobre quem é o atual titular de uma fração específica, marque "verificar_titularidade": true. Nunca retorne como proprietário atual alguém que já conste como vendedor ou transmitente em ato posterior da mesma matrícula.

INSTRUÇÃO 4 — BUSCA DE DADOS DOCUMENTAIS EM ATOS ANTERIORES:
Para cada proprietário atual identificado, extraia CPF, RG e órgão emissor. Se esses dados não estiverem no último ato de transmissão, pesquise em TODOS os atos anteriores da mesma matrícula — compra e venda, inventários, formais de partilha, averbações de qualquer natureza — e retorne os dados documentais encontrados associados ao mesmo nome. Quando os dados vierem de um ato anterior, use "fonte_dados_documentais": "averbacao_anterior". Se não encontrar em nenhum ato, retorne null nos campos e use "fonte_dados_documentais": "nao_encontrado". Se vierem do próprio ato mais recente, use "averbacao_final".

INSTRUÇÃO 5 — ESTADO CIVIL, REGIME DE CASAMENTO E CÔNJUGE:
Para cada proprietário, extraia o estado civil declarado no ato de aquisição ou em averbação posterior. Se o proprietário for casado, extraia também: nome completo do cônjuge, CPF do cônjuge quando mencionado, RG do cônjuge quando mencionado, e regime de bens (comunhão parcial, comunhão universal, separação total, separação obrigatória ou participação final nos aquestos). Essas informações costumam aparecer na qualificação do adquirente no ato de compra e venda ou em averbação de pacto antenupcial. Se o estado civil mudou entre atos (ex: solteiro na compra, casado em averbação posterior), retorne o estado civil mais recente.

INSTRUÇÃO 6 — HIPOTECAS E ÔNUS — IDENTIFICAÇÃO DE STATUS:
Para cada hipoteca encontrada, verifique se existe ato posterior de cancelamento, baixa ou quitação na mesma matrícula que faça referência ao número do ato, livro ou folha da hipoteca original. Preencha o array "hipotecas" com um objeto por hipoteca contendo: descricao (resumo do ato), ato_origem (número/data do ato original), status_hipoteca ("cancelada" se houver baixa, registrando o ato_cancelamento; "ativa" se NÃO houver baixa; "indefinida" se documento incompleto/ilegível) e ato_cancelamento (número do ato de baixa ou null). O campo status_hipoteca é obrigatório para cada hipoteca.`;

const RETRY_PROMPT = (nome: string) =>
  `Na análise anterior NÃO foram encontrados CPF e RG do proprietário atual "${nome}". Pesquise em TODOS os atos anteriores desta matrícula — compra e venda, inventários, formais de partilha, averbações — e retorne quaisquer dados documentais (CPF, RG, órgão emissor, data de nascimento) associados ao nome "${nome}". Retorne SOMENTE JSON no formato:
{
  "nome": "${nome}",
  "cpf": string | null,
  "rg": string | null,
  "rg_orgao": string | null,
  "data_nascimento": string | null,
  "fonte": "averbacao_anterior" | "nao_encontrado"
}`;

const tryParseJson = (content: string): any => {
  try {
    const m = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? (m[1] || m[0]) : content);
  } catch {
    return null;
  }
};

async function callAI(apiKey: string, messages: any[]): Promise<string> {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-2.5-flash", messages }),
  });
  if (!r.ok) {
    const t = await r.text();
    console.error("AI Gateway error:", r.status, t.slice(0, 300));
    if (r.status === 429) throw new Error("RATE_LIMIT");
    if (r.status === 402) throw new Error("NO_CREDITS");
    throw new Error(`AI_GATEWAY_${r.status}`);
  }
  const j = await r.json();
  return j.choices?.[0]?.message?.content ?? "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { pdfPath } = await req.json();
    if (!pdfPath) throw new Error("pdfPath obrigatório");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Download PDF do bucket
    const { data: fileData, error: dErr } = await supabase.storage.from("matriculas").download(pdfPath);
    if (dErr) throw dErr;

    const arrayBuffer = await fileData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
    }
    const base64 = btoa(binary);

    const userContent = [
      { type: "text", text: "Analise esta matrícula de IMÓVEL CONFRONTANTE seguindo rigorosamente as regras do system prompt. Foco: APENAS proprietário(s) atual(is)." },
      { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } },
    ];

    // 1) Primeira chamada
    const content1 = await callAI(lovableApiKey, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ]);

    let parsed = tryParseJson(content1);
    if (!parsed || typeof parsed !== "object") {
      console.error("Parse falhou na 1ª chamada:", content1.slice(0, 400));
      parsed = {
        denominacao_imovel: null, matricula_numero: null, ccir: null,
        municipio: null, uf: null, comarca: null, cartorio: null, area_hectares: null,
        proprietarios_atuais: [],
        alertas: ["Falha ao parsear resposta da IA — revisar manualmente."],
        campos_incertos: ["todos"],
      };
    }

    // Normaliza
    parsed.proprietarios_atuais = Array.isArray(parsed.proprietarios_atuais) ? parsed.proprietarios_atuais : [];
    parsed.alertas = Array.isArray(parsed.alertas) ? parsed.alertas : [];
    parsed.campos_incertos = Array.isArray(parsed.campos_incertos) ? parsed.campos_incertos : [];

    // 2) Retry para proprietários sem CPF E sem RG
    const incompletos = parsed.proprietarios_atuais.filter(
      (p: any) => p?.nome && !p?.cpf && !p?.rg
    );

    if (incompletos.length > 0) {
      console.log(`Retry para ${incompletos.length} proprietário(s) sem dados documentais`);
      for (const prop of incompletos) {
        try {
          const retryContent = await callAI(lovableApiKey, [
            { role: "system", content: "Você é um especialista em matrículas imobiliárias brasileiras. Retorne SOMENTE JSON válido." },
            {
              role: "user",
              content: [
                { type: "text", text: RETRY_PROMPT(prop.nome) },
                { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } },
              ],
            },
          ]);
          const retryData = tryParseJson(retryContent);
          if (retryData && (retryData.cpf || retryData.rg)) {
            const idx = parsed.proprietarios_atuais.findIndex((p: any) => p.nome === prop.nome);
            if (idx >= 0) {
              parsed.proprietarios_atuais[idx] = {
                ...parsed.proprietarios_atuais[idx],
                cpf: parsed.proprietarios_atuais[idx].cpf ?? retryData.cpf ?? null,
                rg: parsed.proprietarios_atuais[idx].rg ?? retryData.rg ?? null,
                rg_orgao: parsed.proprietarios_atuais[idx].rg_orgao ?? retryData.rg_orgao ?? null,
                data_nascimento: parsed.proprietarios_atuais[idx].data_nascimento ?? retryData.data_nascimento ?? null,
                fonte_dados_documentais: "averbacao_anterior",
              };
            }
          }
        } catch (err) {
          console.error(`Retry falhou para ${prop.nome}:`, err);
        }
      }
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg === "RATE_LIMIT" ? 429 : msg === "NO_CREDITS" ? 402 : 500;
    const userMsg =
      msg === "RATE_LIMIT" ? "Limite de requisições excedido. Aguarde alguns minutos." :
      msg === "NO_CREDITS" ? "Créditos de IA esgotados. Adicione créditos no workspace." :
      msg;
    console.error("analyze-neighbor-matricula error:", e);
    return new Response(JSON.stringify({ error: userMsg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
