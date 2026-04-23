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

INSTRUÇÃO 2B — DENOMINAÇÃO ATUAL DO IMÓVEL:

A denominação do imóvel pode ter sido alterada ao longo dos anos por averbações. Para o campo 'identification.denomination', use SEMPRE a denominação mais recente — ou seja, a que consta na última averbação de alteração de nome (expressões como 'passou a denominar-se', 'passa a ser denominado', 'nova denominação', 'denominação alterada para'). Se houver mais de uma averbação alterando o nome, prevalece a mais recente cronologicamente. Ignore denominações de averbações anteriores. Se não houver nenhuma averbação de alteração de nome, use a denominação do cabeçalho da matrícula.

INSTRUÇÃO 3 — IDENTIFICAÇÃO DO PROPRIETÁRIO ATUAL EM MATRÍCULAS COM MUITAS TRANSMISSÕES:
A matrícula pode conter dezenas de atos ao longo dos anos. Para o array "owners" (proprietários atuais), retorne SOMENTE os últimos adquirentes de cada fração do imóvel — ou seja, aqueles que constam como compradores, donatários ou herdeiros em um ato sem que exista ato posterior transferindo a mesma fração a outra pessoa. Ignore todos os transmitentes e adquirentes intermediários. Se houver dúvida sobre quem é o atual titular de uma fração específica, retorne o dado com o campo adicional "verificar_titularidade": true dentro do objeto do proprietário. Nunca retorne como proprietário atual alguém que já conste como vendedor ou transmitente em ato posterior da mesma matrícula.

Quando a titularidade de uma fração resultar de formal de partilha ou inventário, extraia a participação de cada herdeiro conforme declarado no ato — ex: '1/6 (um sexto)', '3/6 (três sextos)', '50%'. Preencha o campo share_percentage de cada proprietário com esse valor. Se a matrícula usa frações (ex: 1/6), converta para percentual aproximado ou mantenha a fração — ex: '1/6 (16,67%)'. Nunca deixe share_percentage vazio para herdeiros de partilha.

INSTRUÇÃO 3B — VERIFICAÇÃO OBRIGATÓRIA DE FALECIMENTO (executa imediatamente após identificar os proprietários pela Instrução 3):

Para CADA proprietário identificado em owners, varrer imediatamente TODAS as averbações da matrícula do início ao fim buscando o nome desse proprietário junto com qualquer das expressões: 'falecimento', 'falecido', 'falecida', 'óbito', 'ocorreu o falecimento', 'certidão de óbito', 'de cujus', 'espólio de', 'espólio do', 'por ato de ofício', 'comunicamos o falecimento', 'em virtude do falecimento'.

ESTA VARREDURA É OBRIGATÓRIA E NÃO PODE SER IGNORADA. Um proprietário que parece 'último adquirente' pela Instrução 3 pode ter falecido depois — a averbação de óbito cancela a titularidade.

Se encontrar averbação de óbito de um proprietário listado em owners:
→ Remover esse proprietário COMPLETAMENTE de owners — ele NUNCA aparece como proprietário atual.
→ Verificar se há formal de partilha ou novo registro posterior ao óbito. Se houver, os herdeiros averbados entram em owners com suas respectivas frações.
→ Se NÃO houver novo titular registrado para a fração, adicionar dois alertas críticos:
   { 'severity': 'critical', 'message': '[FALECIMENTO] O proprietário [NOME] consta como falecido conforme [NÚMERO DA AVERBAÇÃO, ex: AV.25-M.1561], em [DATA]. Fração afetada: [X/Y].' }
   { 'severity': 'critical', 'message': '[ESPÓLIO PENDENTE] A fração de [X/Y] pertencente a [NOME] está sem titular registrado. Necessário inventário e averbação dos herdeiros antes do georreferenciamento.' }

PRECEDÊNCIA ABSOLUTA: óbito averbado sempre cancela a titularidade, mesmo que o ato de aquisição seja mais recente que a maioria dos outros atos.

EXEMPLO CONCRETO: matrícula 1.561 — R.22 atribuiu 3/6 a Aparecida Bottan da Silva. AV.25 registrou falecimento em 22/08/2023. Resultado correto: Aparecida NÃO consta em owners. Silvana (1/6), Vanessa (1/6) e Francisco Carlos (1/6) são os proprietários. Dois alertas críticos gerados.

INSTRUÇÃO 4 — BUSCA DE DADOS DOCUMENTAIS EM ATOS ANTERIORES:
Para cada proprietário atual identificado, extraia CPF, RG e órgão emissor. Se esses dados não estiverem no último ato de transmissão, pesquise em TODOS os atos anteriores da mesma matrícula — compra e venda, inventários, formais de partilha, averbações de qualquer natureza — e retorne os dados documentais encontrados associados ao mesmo nome. Quando os dados vierem de um ato anterior e não do ato mais recente, adicione o campo "fonte_dados_documentais": "averbacao_anterior" no objeto desse proprietário. Se não encontrar em nenhum ato, retorne null e adicione "fonte_dados_documentais": "nao_encontrado". Se vierem do próprio ato mais recente, use "fonte_dados_documentais": "averbacao_final".

INSTRUÇÃO 5 — ESTADO CIVIL, REGIME DE CASAMENTO E CÔNJUGE:
Para cada proprietário, extraia o estado civil declarado no ato de aquisição ou em averbação posterior. Se o proprietário for casado, extraia também: nome completo do cônjuge, CPF do cônjuge quando mencionado, RG do cônjuge quando mencionado, e regime de bens (comunhão parcial, comunhão universal, separação total, separação obrigatória ou participação final nos aquestos). Essas informações costumam aparecer na qualificação do adquirente no ato de compra e venda ou em averbação de pacto antenupcial. Se o estado civil mudou entre atos (ex: solteiro na compra, casado em averbação posterior), retorne o estado civil mais recente.

IMPORTANTE: o campo marriage_regime deve conter SOMENTE o nome do regime de bens (ex: 'comunhão parcial de bens', 'comunhão universal de bens'). NÃO inclua referências à lei, datas ou vigência dentro deste campo — essas informações vão exclusivamente no campo vigencia_lei_divorcio. Exemplos corretos: 'comunhão parcial de bens' (não 'comunhão parcial de bens (Lei 6.515/77)'). O sistema irá compor automaticamente o texto completo usando os dois campos separados.

INSTRUÇÃO 6 — ÔNUS REAIS — IDENTIFICAÇÃO DE STATUS (HIPOTECAS, ALIENAÇÕES FIDUCIÁRIAS E PENHORAS):
Para CADA ônus real encontrado (hipoteca, alienação fiduciária e penhora), verifique se existe ato posterior de cancelamento, baixa, quitação ou liberação na mesma matrícula que faça referência ao número do ato, livro ou folha do ônus original. Quando houver mais de um ônus do mesmo tipo, retorne o respectivo campo SEMPRE como ARRAY de objetos no formato: [{ "descricao": "...", "ato_origem": "...", "status_<tipo>": "ativa" | "cancelada" | "indefinida", "ato_cancelamento": "..." | null }]. O campo de status segue a convenção: hipoteca → "status_hipoteca"; alienação fiduciária → "status_fiduciaria"; penhora → "status_penhora". Use "cancelada" quando encontrar ato de baixa/cancelamento (registrando o número do ato em "ato_cancelamento"); "ativa" quando NÃO houver ato de cancelamento; "indefinida" se o documento estiver incompleto ou ilegível e não for possível determinar. NUNCA retorne ônus como texto corrido livre — sempre como array estruturado mesmo quando houver apenas 1 (um) registro. Os campos "encumbrances.fiduciary_alienation", "encumbrances.seizure" e "encumbrances.mortgage" devem ser ARRAYS quando houver registros, ou strings vazias "" quando não houver nenhum. Reconheça como cancelamento de hipoteca ou cédula rural hipotecária qualquer um destes atos posteriores ao registro: averbação de cancelamento por instrumento particular autorizado pelo credor, baixa por liquidação da dívida, cancelamento por mandado judicial de quitação, ou qualquer averbação que mencione 'liquidação da dívida', 'cancelamento do R.', 'autorizado o cancelamento', 'em virtude da liquidação'. Cédula Rural Hipotecária e Cédula de Crédito Rural têm o mesmo tratamento de hipoteca para fins de status.

INSTRUÇÃO 7 — REGIME DE CASAMENTO E ENQUADRAMENTO LEGISLATIVO:

O campo vigencia_lei_divorcio deve refletir o enquadramento legal do casamento em um dos três períodos históricos da legislação brasileira de regime de bens. Os valores possíveis agora são:
- 'antes_da_vigencia_6515': casamento sob o Código Civil de 1916 (antes de 26/12/1977) — regime padrão era comunhão universal de bens
- 'vigencia_6515': casamento sob a Lei 6.515/77 (de 26/12/1977 a 10/01/2003) — regime padrão passou a ser comunhão parcial de bens
- 'vigencia_cc2002': casamento sob o Código Civil de 2002 — Lei 10.406/2002 (a partir de 11/01/2003) — mantém comunhão parcial como padrão; separação obrigatória para maiores de 70 anos (após Lei 12.344/2010)
- 'nao_identificado': quando não for possível determinar por nenhuma das regras abaixo

REGRA 1 — LEITURA DIRETA DO TEXTO DA MATRÍCULA (tem precedência absoluta):
Pesquise na qualificação do proprietário e nas averbações de casamento as seguintes expressões e mapeie conforme abaixo:

→ 'antes_da_vigencia_6515':
  Expressões: 'anteriormente à vigência da Lei 6.515/77', 'anterior à vigência da Lei 6.515', 'antes da vigência da Lei 6.515', 'sob o regime anterior à Lei 6.515', 'comunhão universal de bens anteriormente'

→ 'vigencia_6515':
  Expressões: 'na vigência da Lei 6.515/77', 'na vigência da Lei nº 6.515', 'após a Lei 6.515/77', 'sob a égide da Lei 6.515', 'na vigência da lei do divórcio'

→ 'vigencia_cc2002':
  Expressões: 'na vigência do Código Civil', 'na vigência do novo Código Civil', 'na vigência da Lei 10.406', 'nos termos do Código Civil de 2002', 'sob o Código Civil vigente'

REGRA 2 — FALLBACK POR DATA DO CASAMENTO (somente se o texto não mencionar a lei):
Se a matrícula contiver a data do casamento mas não mencionar explicitamente a lei:
- Casamento antes de 26/12/1977 → 'antes_da_vigencia_6515'
- Casamento de 26/12/1977 a 10/01/2003 → 'vigencia_6515'
- Casamento a partir de 11/01/2003 → 'vigencia_cc2002'
- Data não disponível → 'nao_identificado'

NOTA SOBRE SEPARAÇÃO OBRIGATÓRIA:
Se a matrícula indicar separação obrigatória de bens por idade (cônjuge idoso), registre o regime como 'separacao_obrigatoria' no campo marriage_regime e identifique o período legislativo normalmente no campo vigencia_lei_divorcio.

INSTRUÇÃO 8 — CCIR E REGISTRO NO INCRA:
O número do CCIR pode não aparecer com essa denominação na matrícula. Pesquise também por: 'registrado no INCRA sob o número', 'cadastrado no INCRA', 'inscrição no INCRA nº', 'registro INCRA nº', 'matrícula no INCRA', ou qualquer menção a número de cadastro junto ao INCRA. Se encontrar esse número por essa via alternativa, retorne-o no campo "identification.ccir" normalmente e adicione "identification.ccir_fonte": 'registro_incra' para indicar que foi identificado por denominação alternativa. Se encontrar pela denominação CCIR padrão, use "identification.ccir_fonte": 'ccir'. Se não encontrar de nenhuma forma, retorne "identification.ccir": null e "identification.ccir_fonte": 'nao_encontrado'.

INSTRUÇÃO 9 — CASAL COMO PROPRIETÁRIO ÚNICO:
Quando dois proprietários do mesmo ato de aquisição forem casados entre si — identificável porque o cônjuge de um é o nome/CPF do outro — NÃO os retorne como dois proprietários separados. Retorne SOMENTE O PRIMEIRO listado como proprietário principal, com o segundo preenchido no campo cônjuge desse proprietário.

Sinais de que são o mesmo casal:
- O campo nome do cônjuge do proprietário A é igual ao nome do proprietário B
- O campo CPF do cônjuge do proprietário A é igual ao CPF do proprietário B
- Ambos têm o mesmo endereço
- Ambos têm o mesmo regime de casamento

Quando identificar esse padrão: mantenha o proprietário A com todos os dados originais intactos, incluindo o share_percentage original de A — NÃO altere, some ou substitua a participação de A. No campo cônjuge, preencha TODOS os dados de B disponíveis: { name: nome de B, cpf: CPF de B, rg: RG de B, share_percentage: participação de B se existir }. É obrigatório incluir o CPF de B no campo cônjuge.cpf quando disponível na matrícula. Remova completamente o proprietário B da lista owners.

Esta regra só se aplica quando os dois são claramente o mesmo casal. Se dois proprietários forem casados com TERCEIROS diferentes (não entre si), ambos devem ser listados normalmente como proprietários separados.

REGRAS CRÍTICAS ao mesclar o casal:
1. O campo share_percentage do proprietário A DEVE permanecer com o valor exato que tinha ANTES da mesclagem. Se A tinha 50%, continua com 50% após remover B. NUNCA recalcule ou mude para 100%.
2. Os campos name, marital_status e nationality de A devem ser no SINGULAR referindo-se apenas a A (ex: 'casado', 'brasileiro') — NÃO use plural mesmo que o ato da matrícula qualifique o casal conjuntamente como 'casados' ou 'brasileiros'.
3. O campo spouse.cpf DEVE ser preenchido com o CPF de B quando disponível na matrícula.

INSTRUÇÃO 10 — VERIFICAÇÃO OBRIGATÓRIA DE FALECIMENTO:

Esta verificação deve ser executada APÓS identificar os proprietários atuais e ANTES de retornar o JSON. É obrigatória mesmo que o proprietário seja o último adquirente registrado.

PASSO 1 — ESCOPO DA VERIFICAÇÃO: Esta verificação aplica-se EXCLUSIVAMENTE aos proprietários já confirmados como atuais pelo critério da Instrução 3 (últimos adquirentes de cada fração sem transmissão posterior). NÃO aplique esta verificação a transmitentes anteriores, vendedores, herdeiros intermediários ou qualquer pessoa que não esteja listada como proprietária atual. Se uma pessoa aparece na matrícula apenas como vendedora ou como parte de inventário em que outra pessoa recebeu a fração e posteriormente vendeu, ela NÃO deve gerar alerta de falecimento. Para cada proprietário CONFIRMADO em owners, varrer todas as averbações buscando seu nome junto com: 'falecimento', 'falecido', 'falecida', 'óbito', 'ocorreu o falecimento', 'certidão de óbito', 'de cujus', 'espólio de', 'espólio do', 'por ato de ofício'.

PASSO 2: Se encontrar averbação de óbito referente a um proprietário de owners:
- Remover esse proprietário completamente de owners. Ele NUNCA deve aparecer como proprietário atual.
- Verificar se houver formal de partilha ou inventário posterior ao óbito para a fração dele. Se sim, os novos titulares entram em owners com suas respectivas frações.
- Gerar alerta: { "severity": "critical", "message": "[FALECIMENTO] O proprietário [NOME] consta como falecido na matrícula conforme [NÚMERO DA AVERBAÇÃO]. Data: [DATA SE DISPONÍVEL]. Fração afetada: [X]." }

PASSO 3: Se a fração do falecido não tiver novo titular registrado:
- Gerar segundo alerta: { "severity": "critical", "message": "[ESPÓLIO PENDENTE] A fração de [X] pertencente a [NOME DO FALECIDO] está sem titular registrado. Necessário inventário e averbação dos herdeiros antes do georreferenciamento." }

PASSO 4 — PRECEDÊNCIA ABSOLUTA: Um ato de óbito averbado SEMPRE cancela a titularidade anterior, independentemente de qual ato constituiu a propriedade. Proprietário falecido NUNCA aparece em owners.

EXEMPLO: matrícula onde R.22 atribuiu 3/6 a Aparecida Bottan da Silva e AV.25 registrou falecimento em 22/08/2023 — Aparecida NÃO deve constar em owners. Gerar alerta de falecimento (AV.25) e alerta de espólio pendente (3/6).`;

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

    // Convert PDF to base64 for vision model (memory-efficient streaming encode)
    const arrayBuffer = await fileData.arrayBuffer();
    const sizeMb = arrayBuffer.byteLength / (1024 * 1024);
    console.log(`process-matricula: PDF size = ${sizeMb.toFixed(2)} MB`);
    if (sizeMb > 20) {
      return new Response(
        JSON.stringify({ error: `PDF muito grande (${sizeMb.toFixed(1)} MB). Limite: 20 MB. Reduza o arquivo e tente novamente.` }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { encodeBase64 } = await import("https://deno.land/std@0.224.0/encoding/base64.ts");
    const base64 = encodeBase64(new Uint8Array(arrayBuffer));

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

    const tryParse = (raw: string) => {
      try {
        const m = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/\{[\s\S]*\}/);
        return JSON.parse(m ? (m[1] || m[0]) : raw);
      } catch { return null; }
    };

    let parsed = tryParse(content);

    // Retry quando parse falhou ou owners estão todos vazios
    const ownersEmpty = !parsed || !Array.isArray(parsed.owners) ||
      parsed.owners.length === 0 ||
      parsed.owners.every((o: any) => !o?.name);

    if (ownersEmpty) {
      console.log("process-matricula: 1ª chamada veio vazia, executando retry");
      const retryResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
                  text: "A análise anterior retornou campos vazios. Tente novamente com atenção máxima ao texto. O documento pode ter marca d'água intensa, ser datilografado ou ter baixa qualidade. Extraia qualquer dado legível. Para campos ilegíveis use '[ilegível]' em vez de string vazia.",
                },
                {
                  type: "image_url",
                  image_url: { url: `data:application/pdf;base64,${base64}` },
                },
              ],
            },
          ],
        }),
      });
      if (retryResp.ok) {
        const retryJson = await retryResp.json();
        const retryContent = retryJson.choices?.[0]?.message?.content ?? "";
        const retryParsed = tryParse(retryContent);
        if (retryParsed && typeof retryParsed === "object") {
          parsed = retryParsed;
        }
      }
    }

    if (!parsed || typeof parsed !== "object") {
      parsed = { identification: {}, owners: [], boundaries: {}, encumbrances: {}, transfers: [] };
    }

    const extracted_data = {
      identification: parsed.identification ?? {},
      owners: parsed.owners ?? [],
      usufructuaries: parsed.usufructuaries ?? [],
      boundaries: parsed.boundaries ?? {},
      encumbrances: parsed.encumbrances ?? {},
      transfers: parsed.transfers ?? [],
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
