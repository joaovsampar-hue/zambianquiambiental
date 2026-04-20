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
Este documento pode conter marcas d'água diagonais ou repetidas sobrepostas ao texto, com conteúdos como "VISUALIZAÇÃO ÚNICA", "CÓPIA NÃO AUTORIZADA", nome do cartório, data e hora de emissão, ou número de protocolo. Ignore completamente qualquer texto que faça parte da marca d'água — esses textos não são conteúdo jurídico da matrícula. Concentre-se exclusivamente no conteúdo da matrícula: cabeçalho, atos, averbações e transcrições. Se um campo de dado estiver parcialmente encoberto pela marca d'água, tente inferir o valor pelo contexto e indique esse campo com o sufixo "[inferido]" no valor retornado.

INSTRUÇÃO 2 — DOCUMENTOS ANTIGOS E DATILOGRAFADOS:
O documento pode ter sido produzido em máquina de escrever, com espaçamento irregular entre caracteres, abreviações de época (ex: Crs$ para cruzeiros, V.Exª, fls., R.I., Dr.ª, S/A), rasuras com correção sobreescrita, carimbos sobrepostos ao texto, numeração de folhas inserida no meio de frases e texto em caixa alta. Ao encontrar essas situações: normalize abreviações conhecidas para a forma completa; preserve números de documentos, matrículas e áreas EXATAMENTE como grafados — não corrija nem formate; para nomes em caixa alta, converta para formato nome próprio padrão; para valores monetários históricos, registre o valor e a moeda como constam sem conversão.

INSTRUÇÃO 3 — IDENTIFICAÇÃO DO PROPRIETÁRIO ATUAL EM MATRÍCULAS COM MUITAS TRANSMISSÕES:
A matrícula pode conter dezenas de atos ao longo dos anos. Para o array "owners" (proprietários atuais), retorne SOMENTE os últimos adquirentes de cada fração do imóvel — ou seja, aqueles que constam como compradores, donatários ou herdeiros em um ato sem que exista ato posterior transferindo a mesma fração a outra pessoa. Ignore todos os transmitentes e adquirentes intermediários. Se houver dúvida sobre quem é o atual titular de uma fração específica, retorne o dado com o campo adicional "verificar_titularidade": true dentro do objeto do proprietário. Nunca retorne como proprietário atual alguém que já conste como vendedor ou transmitente em ato posterior da mesma matrícula.

INSTRUÇÃO 4 — BUSCA DE DADOS DOCUMENTAIS EM ATOS ANTERIORES:
Para cada proprietário atual identificado, extraia CPF, RG e órgão emissor. Se esses dados não estiverem no último ato de transmissão, pesquise em TODOS os atos anteriores da mesma matrícula — compra e venda, inventários, formais de partilha, averbações de qualquer natureza — e retorne os dados documentais encontrados associados ao mesmo nome. Quando os dados vierem de um ato anterior e não do ato mais recente, adicione o campo "fonte_dados_documentais": "averbacao_anterior" no objeto desse proprietário. Se não encontrar em nenhum ato, retorne null e adicione "fonte_dados_documentais": "nao_encontrado". Se vierem do próprio ato mais recente, use "fonte_dados_documentais": "averbacao_final".

INSTRUÇÃO 5 — ESTADO CIVIL, REGIME DE CASAMENTO E CÔNJUGE:
Para cada proprietário, extraia o estado civil declarado no ato de aquisição ou em averbação posterior. Se o proprietário for casado, extraia também: nome completo do cônjuge, CPF do cônjuge quando mencionado, RG do cônjuge quando mencionado, e regime de bens (comunhão parcial, comunhão universal, separação total, separação obrigatória ou participação final nos aquestos). Essas informações costumam aparecer na qualificação do adquirente no ato de compra e venda ou em averbação de pacto antenupcial. Se o estado civil mudou entre atos (ex: solteiro na compra, casado em averbação posterior), retorne o estado civil mais recente.

INSTRUÇÃO 6 — ÔNUS REAIS — IDENTIFICAÇÃO DE STATUS (HIPOTECAS, ALIENAÇÕES FIDUCIÁRIAS E PENHORAS):
Para CADA ônus real encontrado (hipoteca, alienação fiduciária e penhora), verifique se existe ato posterior de cancelamento, baixa, quitação ou liberação na mesma matrícula que faça referência ao número do ato, livro ou folha do ônus original. Quando houver mais de um ônus do mesmo tipo, retorne o respectivo campo SEMPRE como ARRAY de objetos no formato: [{ "descricao": "...", "ato_origem": "...", "status_<tipo>": "ativa" | "cancelada" | "indefinida", "ato_cancelamento": "..." | null }]. O campo de status segue a convenção: hipoteca → "status_hipoteca"; alienação fiduciária → "status_fiduciaria"; penhora → "status_penhora". Use "cancelada" quando encontrar ato de baixa/cancelamento (registrando o número do ato em "ato_cancelamento"); "ativa" quando NÃO houver ato de cancelamento; "indefinida" se o documento estiver incompleto ou ilegível e não for possível determinar. NUNCA retorne ônus como texto corrido livre — sempre como array estruturado mesmo quando houver apenas 1 (um) registro. Os campos "encumbrances.fiduciary_alienation", "encumbrances.seizure" e "encumbrances.mortgage" devem ser ARRAYS quando houver registros, ou strings vazias "" quando não houver nenhum.

INSTRUÇÃO 7 — REGIME DE CASAMENTO E LEI 6.515/77:
Ao extrair o regime de casamento de um proprietário, identifique também o enquadramento legal conforme a data do casamento:
- Casamento anterior a 26/12/1977 (antes da vigência da Lei 6.515/77): regime padrão era comunhão universal de bens, salvo pacto antenupcial em contrário. Retorne vigencia_lei_divorcio: 'antes_da_vigencia'.
- Casamento a partir de 26/12/1977 (na vigência ou após): regime padrão passou a ser comunhão parcial de bens. Retorne vigencia_lei_divorcio: 'apos_vigencia'.
- Se a data do casamento não estiver disponível mas o regime estiver explícito na matrícula, retorne vigencia_lei_divorcio: 'nao_identificado'.
Adicione o campo "vigencia_lei_divorcio" ao objeto de cada proprietário no JSON retornado.

INSTRUÇÃO 8 — CCIR E REGISTRO NO INCRA:
O número do CCIR pode não aparecer com essa denominação na matrícula. Pesquise também por: 'registrado no INCRA sob o número', 'cadastrado no INCRA', 'inscrição no INCRA nº', 'registro INCRA nº', 'matrícula no INCRA', ou qualquer menção a número de cadastro junto ao INCRA. Se encontrar esse número por essa via alternativa, retorne-o no campo "identification.ccir" normalmente e adicione "identification.ccir_fonte": 'registro_incra' para indicar que foi identificado por denominação alternativa. Se encontrar pela denominação CCIR padrão, use "identification.ccir_fonte": 'ccir'. Se não encontrar de nenhuma forma, retorne "identification.ccir": null e "identification.ccir_fonte": 'nao_encontrado'.

INSTRUÇÃO 9 — CASAL COMO PROPRIETÁRIO ÚNICO:
Quando dois proprietários do mesmo ato de aquisição forem casados entre si — identificável porque o cônjuge de um é o nome/CPF do outro — NÃO os retorne como dois proprietários separados. Retorne SOMENTE O PRIMEIRO listado como proprietário principal, com o segundo preenchido no campo cônjuge desse proprietário.

Sinais de que são o mesmo casal:
- O campo nome do cônjuge do proprietário A é igual ao nome do proprietário B
- O campo CPF do cônjuge do proprietário A é igual ao CPF do proprietário B
- Ambos têm o mesmo endereço
- Ambos têm o mesmo regime de casamento

Quando identificar esse padrão: mantenha o proprietário A (primeiro listado no ato) com todos os dados completos. No campo cônjuge dele, preencha com os dados do proprietário B. Remova completamente o proprietário B da lista owners.

Esta regra só se aplica quando os dois são claramente o mesmo casal. Se dois proprietários forem casados com TERCEIROS diferentes (não entre si), ambos devem ser listados normalmente como proprietários separados.

INSTRUÇÃO 10 — VERIFICAÇÃO DE FALECIMENTO APÓS IDENTIFICAR PROPRIETÁRIOS ATUAIS:

Após identificar os proprietários atuais pela Instrução 3, executar obrigatoriamente esta verificação para CADA proprietário identificado antes de retornar o JSON:

PASSO 1 — VARREDURA OBRIGATÓRIA DE ÓBITO:
Percorrer TODAS as averbações da matrícula do início ao fim, inclusive as mais recentes e as últimas páginas, buscando o nome de cada proprietário atual junto com qualquer das seguintes palavras ou expressões: "falecimento", "falecido", "falecida", "óbito", "ocorreu o falecimento", "certidão de óbito", "de cujus", "espólio de", "por ato de ofício". Esta varredura é obrigatória mesmo que o proprietário tenha sido adquirente em ato recente — um óbito averbado posteriormente cancela a titularidade.

PASSO 2 — SE ENCONTRAR AVERBAÇÃO DE ÓBITO REFERENTE A UM PROPRIETÁRIO ATUAL:
- Remover completamente esse proprietário do array owners. Ele NÃO deve aparecer como proprietário atual.
- Identificar a fração do imóvel que pertencia a ele (ex: 3/6, 50%, etc.).
- Verificar se há formal de partilha, inventário ou novo registro de transmissão posterior ao óbito para essa fração. Se sim, os novos titulares são os proprietários atuais dessa fração — incluí-los em owners.
- Gerar alerta crítico: { "severity": "critical", "message": "[FALECIMENTO] O proprietário [NOME] consta como falecido na matrícula conforme [NÚMERO DA AVERBAÇÃO]. Data do falecimento: [DATA SE DISPONÍVEL]. A fração de [X] do imóvel foi afetada." }

PASSO 3 — FRAÇÃO SEM NOVO TITULAR REGISTRADO:
Se após o óbito não houver inventário ou transmissão registrada para a fração do falecido, gerar segundo alerta crítico: { "severity": "critical", "message": "[ESPÓLIO PENDENTE] A fração de [X] pertencente a [NOME DO FALECIDO] está sem titular registrado. É necessário inventário e averbação dos herdeiros antes do georreferenciamento." }

PASSO 4 — ORDEM DE PRECEDÊNCIA:
Um ato de óbito averbado SEMPRE tem precedência sobre a titularidade anterior, independentemente de qual ato constituiu a propriedade. A morte extingue a titularidade — o falecido nunca deve aparecer em owners.

EXEMPLO CONCRETO DESTA INSTRUÇÃO:
Em uma matrícula onde o R.22 atribuiu 3/6 a Aparecida Bottan da Silva e o AV.25 registrou seu falecimento em 22/08/2023: Aparecida NÃO deve constar em owners. Os proprietários atuais de suas frações dependem de inventário posterior. Se não houver inventário registrado, gerar alerta de espólio pendente dos 3/6. Os demais proprietários com frações próprias sem óbito (Silvana 1/6, Vanessa 1/6, Francisco Carlos 1/6) permanecem normalmente em owners.`;

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
