// Edge function dedicada à análise de MATRÍCULA DE IMÓVEL CONFRONTANTE.
// Diferente de process-matricula (imóvel principal), este prompt foca em:
//  - Identificar SOMENTE o(s) proprietário(s) atual(is)
//  - Buscar dados documentais (CPF/RG) em averbações anteriores quando ausentes
//  - NÃO extrair ônus, hipotecas ou alertas (esses dados não são necessários para confrontante)
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

const SYSTEM_PROMPT = `Você está analisando a matrícula de um IMÓVEL CONFRONTANTE, NÃO do imóvel principal do processo. Seu objetivo é extrair APENAS dois grupos de dados com máxima precisão: (1) proprietário(s) atual(is) e (2) identificação do imóvel. NÃO extraia ônus, hipotecas, restrições ou alertas — esses dados são irrelevantes para a análise de confrontante.

CATEGORIA 1 — PROPRIETÁRIO(S) ATUAL(IS):
Percorra TODOS os atos da matrícula em ordem cronológica. O proprietário atual é o último adquirente de cada fração SEM ato posterior de transmissão. Ignore transmitentes e adquirentes intermediários. Para cada proprietário atual, extraia: nome completo, CPF, RG e órgão emissor, estado civil, regime de casamento, dados do cônjuge.
Se o proprietário atual NÃO tiver CPF/RG mencionados na averbação final, PESQUISE EM TODAS AS AVERBAÇÕES ANTERIORES da MESMA matrícula — esses dados podem estar em atos anteriores de compra e venda, inventário ou formal de partilha. Sinalize \`fonte_dados_documentais: "averbacao_anterior"\` quando os dados vierem de atos que não sejam o último.
Em caso de dúvida sobre quem é o atual titular, retorne com flag \`verificar_titularidade: true\`.

CATEGORIA 2 — IDENTIFICAÇÃO DO IMÓVEL CONFRONTANTE:
Extraia: denominação oficial, número da matrícula, número do CCIR (procure em TODAS as páginas, inclusive cabeçalho e averbações), município e UF, comarca, cartório de registro, área total em hectares.

REGRAS CRÍTICAS:
- NUNCA confunda dados deste imóvel com o imóvel principal mencionado em referências cruzadas
- Ignore completamente textos de marca d'água
- Documentos antigos datilografados: normalize dados mas preserve números documentais EXATAMENTE
- NÃO retorne campos de ônus, hipotecas, alienações fiduciárias, penhoras, servidões ou alertas — esses dados não são necessários
- Retorne SEMPRE JSON válido, mesmo que campos estejam null — NUNCA string vazia ou objeto incompleto

Retorne EXATAMENTE este schema (sem markdown, sem texto adicional):
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
  "proprietarios_atuais": [{
    "nome": string | null,
    "cpf": string | null,
    "rg": string | null,
    "rg_orgao": string | null,
    "data_nascimento": string | null,
    "estado_civil": string | null,
    "regime_casamento": string | null,
    "vigencia_lei_divorcio": "antes_da_vigencia" | "apos_vigencia" | "nao_identificado",
    "conjuge_nome": string | null,
    "conjuge_cpf": string | null,
    "fracao": string | null,
    "verificar_titularidade": boolean,
    "fonte_dados_documentais": "averbacao_final" | "averbacao_anterior" | "nao_encontrado"
  }],
  "campos_incertos": string[]
}

=== INSTRUÇÕES ADICIONAIS PARA MATRÍCULAS DIFÍCEIS ===

INSTRUÇÃO 1 — MARCA D'ÁGUA E PROTEÇÃO DE CÓPIA:
Este documento pode conter marcas d'água diagonais ou repetidas sobrepostas ao texto, com conteúdos como "VISUALIZAÇÃO ÚNICA", "CÓPIA NÃO AUTORIZADA", nome do cartório, data e hora de emissão, ou número de protocolo. Ignore completamente qualquer texto que faça parte da marca d'água — esses textos não são conteúdo jurídico da matrícula. Concentre-se exclusivamente no conteúdo da matrícula: cabeçalho, atos, averbações e transcrições. Se um campo de dado estiver parcialmente encoberto pela marca d'água, tente inferir o valor pelo contexto e indique esse campo com o sufixo "[inferido]" no valor retornado.

INSTRUÇÃO 2 — DOCUMENTOS ANTIGOS E DATILOGRAFADOS:
O documento pode ter sido produzido em máquina de escrever, com espaçamento irregular entre caracteres, abreviações de época (ex: Crs$ para cruzeiros, V.Exª, fls., R.I., Dr.ª, S/A), rasuras com correção sobreescrita, carimbos sobrepostos ao texto, numeração de folhas inserida no meio de frases e texto em caixa alta. Ao encontrar essas situações: normalize abreviações conhecidas para a forma completa; preserve números de documentos, matrículas e áreas EXATAMENTE como grafados — não corrija nem formate; para nomes em caixa alta, converta para formato nome próprio padrão; para valores monetários históricos, registre o valor e a moeda como constam sem conversão.

INSTRUÇÃO 2B — DENOMINAÇÃO ATUAL DO IMÓVEL:

A denominação do imóvel pode ter sido alterada ao longo dos anos por averbações. Para o campo 'denominacao_imovel', use SEMPRE a denominação mais recente — ou seja, a que consta na última averbação de alteração de nome (expressões como 'passou a denominar-se', 'passa a ser denominado', 'nova denominação', 'denominação alterada para'). Se houver mais de uma averbação alterando o nome, prevalece a mais recente cronologicamente. Ignore denominações de averbações anteriores. Se não houver nenhuma averbação de alteração de nome, use a denominação do cabeçalho da matrícula.

INSTRUÇÃO 3 — IDENTIFICAÇÃO DO PROPRIETÁRIO ATUAL EM MATRÍCULAS COM MUITAS TRANSMISSÕES:
A matrícula pode conter dezenas de atos ao longo dos anos. Para "proprietarios_atuais", retorne SOMENTE os últimos adquirentes de cada fração do imóvel — ou seja, aqueles que constam como compradores, donatários ou herdeiros em um ato sem que exista ato posterior transferindo a mesma fração a outra pessoa. Ignore todos os transmitentes e adquirentes intermediários. Se houver dúvida sobre quem é o atual titular de uma fração específica, marque "verificar_titularidade": true. Nunca retorne como proprietário atual alguém que já conste como vendedor ou transmitente em ato posterior da mesma matrícula.

Quando a titularidade de uma fração resultar de formal de partilha ou inventário, extraia a participação de cada herdeiro conforme declarado no ato — ex: '1/6 (um sexto)', '3/6 (três sextos)', '50%'. Preencha o campo share_percentage de cada proprietário com esse valor. Se a matrícula usa frações (ex: 1/6), converta para percentual aproximado ou mantenha a fração — ex: '1/6 (16,67%)'. Nunca deixe share_percentage vazio para herdeiros de partilha.

INSTRUÇÃO 3B — VERIFICAÇÃO OBRIGATÓRIA DE FALECIMENTO (executa imediatamente após identificar os proprietários pela Instrução 3):

Para CADA proprietário identificado em proprietarios_atuais, varrer imediatamente TODAS as averbações da matrícula do início ao fim buscando o nome desse proprietário junto com qualquer das expressões: 'falecimento', 'falecido', 'falecida', 'óbito', 'ocorreu o falecimento', 'certidão de óbito', 'de cujus', 'espólio de', 'espólio do', 'por ato de ofício', 'comunicamos o falecimento', 'em virtude do falecimento'.

ESTA VARREDURA É OBRIGATÓRIA E NÃO PODE SER IGNORADA. Um proprietário que parece 'último adquirente' pela Instrução 3 pode ter falecido depois — a averbação de óbito cancela a titularidade.

Se encontrar averbação de óbito de um proprietário listado em proprietarios_atuais:
→ Remover esse proprietário COMPLETAMENTE de proprietarios_atuais — ele NUNCA aparece como proprietário atual.
→ Verificar se há formal de partilha ou novo registro posterior ao óbito. Se houver, os herdeiros averbados entram em proprietarios_atuais com suas frações.
→ Se NÃO houver novo titular registrado para a fração, adicionar dois alertas críticos:
   { 'severity': 'critical', 'message': '[FALECIMENTO] O proprietário [NOME] consta como falecido conforme [NÚMERO DA AVERBAÇÃO, ex: AV.25-M.1561], em [DATA]. Fração afetada: [X/Y].' }
   { 'severity': 'critical', 'message': '[ESPÓLIO PENDENTE] A fração de [X/Y] pertencente a [NOME] está sem titular registrado. Necessário inventário e averbação dos herdeiros antes do georreferenciamento.' }

PRECEDÊNCIA ABSOLUTA: óbito averbado sempre cancela a titularidade, mesmo que o ato de aquisição seja mais recente que a maioria dos outros atos.

EXEMPLO CONCRETO: matrícula 1.561 — R.22 atribuiu 3/6 a Aparecida Bottan da Silva. AV.25 registrou falecimento em 22/08/2023. Resultado correto: Aparecida NÃO consta em proprietarios_atuais. Silvana (1/6), Vanessa (1/6) e Francisco Carlos (1/6) são os proprietários. Dois alertas críticos gerados.

INSTRUÇÃO 4 — BUSCA DE DADOS DOCUMENTAIS EM ATOS ANTERIORES:
Para cada proprietário atual identificado, extraia CPF, RG e órgão emissor. Se esses dados não estiverem no último ato de transmissão, pesquise em TODOS os atos anteriores da mesma matrícula — compra e venda, inventários, formais de partilha, averbações de qualquer natureza — e retorne os dados documentais encontrados associados ao mesmo nome. Quando os dados vierem de um ato anterior, use "fonte_dados_documentais": "averbacao_anterior". Se não encontrar em nenhum ato, retorne null nos campos e use "fonte_dados_documentais": "nao_encontrado". Se vierem do próprio ato mais recente, use "averbacao_final".

INSTRUÇÃO 5 — ESTADO CIVIL, REGIME DE CASAMENTO E CÔNJUGE:
Para cada proprietário, extraia o estado civil declarado no ato de aquisição ou em averbação posterior. Se o proprietário for casado, extraia também: nome completo do cônjuge, CPF do cônjuge quando mencionado, RG do cônjuge quando mencionado, e regime de bens (comunhão parcial, comunhão universal, separação total, separação obrigatória ou participação final nos aquestos). Essas informações costumam aparecer na qualificação do adquirente no ato de compra e venda ou em averbação de pacto antenupcial. Se o estado civil mudou entre atos (ex: solteiro na compra, casado em averbação posterior), retorne o estado civil mais recente.

IMPORTANTE: o campo marriage_regime deve conter SOMENTE o nome do regime de bens (ex: 'comunhão parcial de bens', 'comunhão universal de bens'). NÃO inclua referências à lei, datas ou vigência dentro deste campo — essas informações vão exclusivamente no campo vigencia_lei_divorcio. Exemplos corretos: 'comunhão parcial de bens' (não 'comunhão parcial de bens (Lei 6.515/77)'). O sistema irá compor automaticamente o texto completo usando os dois campos separados.

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
O número do CCIR pode não aparecer com essa denominação na matrícula. Pesquise também por: 'registrado no INCRA sob o número', 'cadastrado no INCRA', 'inscrição no INCRA nº', 'registro INCRA nº', 'matrícula no INCRA', ou qualquer menção a número de cadastro junto ao INCRA. Se encontrar esse número por essa via alternativa, retorne-o no campo "ccir" normalmente e use "ccir_fonte": 'registro_incra'. Se encontrar pela denominação CCIR padrão, use "ccir_fonte": 'ccir'. Se não encontrar de nenhuma forma, retorne "ccir": null e "ccir_fonte": 'nao_encontrado'.

INSTRUÇÃO 9 — CASAL COMO PROPRIETÁRIO ÚNICO:
Quando dois proprietários do mesmo ato de aquisição forem casados entre si — identificável porque o cônjuge de um é o nome ou CPF do outro — NÃO os retorne como dois proprietários separados. Retorne SOMENTE O PRIMEIRO listado como proprietário principal, com o segundo preenchido no campo cônjuge desse proprietário.

Sinais de que são o mesmo casal:
- O campo conjuge_nome do proprietário A é igual ao nome do proprietário B
- O campo conjuge_cpf do proprietário A é igual ao CPF do proprietário B
- Ambos têm o mesmo endereço e regime de casamento

Quando identificar esse padrão: mantenha o proprietário A com todos os dados originais intactos, incluindo o share_percentage original de A — NÃO altere, some ou substitua a participação de A. No campo cônjuge, preencha TODOS os dados de B disponíveis: { name: nome de B, cpf: CPF de B, rg: RG de B, share_percentage: participação de B se existir }. É obrigatório incluir o CPF de B no campo cônjuge.cpf quando disponível na matrícula. Remova completamente o proprietário B da lista proprietarios_atuais.

Esta regra NÃO se aplica quando dois proprietários são casados com terceiros diferentes — nesse caso ambos permanecem na lista normalmente.

REGRAS CRÍTICAS ao mesclar o casal:
1. O campo share_percentage do proprietário A DEVE permanecer com o valor exato que tinha ANTES da mesclagem. Se A tinha 50%, continua com 50% após remover B. NUNCA recalcule ou mude para 100%.
2. Os campos name, marital_status e nationality de A devem ser no SINGULAR referindo-se apenas a A (ex: 'casado', 'brasileiro') — NÃO use plural mesmo que o ato da matrícula qualifique o casal conjuntamente como 'casados' ou 'brasileiros'.
3. O campo spouse.cpf DEVE ser preenchido com o CPF de B quando disponível na matrícula.

INSTRUÇÃO 10 — VERIFICAÇÃO OBRIGATÓRIA DE FALECIMENTO:

Esta verificação deve ser executada APÓS identificar os proprietários atuais e ANTES de retornar o JSON. É obrigatória mesmo que o proprietário seja o último adquirente registrado.

PASSO 1 — ESCOPO DA VERIFICAÇÃO: Esta verificação aplica-se EXCLUSIVAMENTE aos proprietários já confirmados como atuais pelo critério da Instrução 3 (últimos adquirentes de cada fração sem transmissão posterior). NÃO aplique esta verificação a transmitentes anteriores, vendedores, herdeiros intermediários ou qualquer pessoa que não esteja listada como proprietária atual. Se uma pessoa aparece na matrícula apenas como vendedora ou como parte de inventário em que outra pessoa recebeu a fração e posteriormente vendeu, ela NÃO deve gerar alerta de falecimento. Para cada proprietário CONFIRMADO em owners, varrer todas as averbações buscando seu nome junto com: 'falecimento', 'falecido', 'falecida', 'óbito', 'ocorreu o falecimento', 'certidão de óbito', 'de cujus', 'espólio de', 'espólio do', 'por ato de ofício'.

PASSO 2: Se encontrar averbação de óbito referente a um proprietário de owners:
- Remover esse proprietário completamente de owners. Ele NUNCA deve aparecer como proprietário atual.
- Verificar se há formal de partilha ou inventário posterior ao óbito para a fração dele. Se sim, os novos titulares entram em owners com suas respectivas frações.
- Gerar alerta: { "severity": "critical", "message": "[FALECIMENTO] O proprietário [NOME] consta como falecido na matrícula conforme [NÚMERO DA AVERBAÇÃO]. Data: [DATA SE DISPONÍVEL]. Fração afetada: [X]." }

PASSO 3: Se a fração do falecido não tiver novo titular registrado:
- Gerar segundo alerta: { "severity": "critical", "message": "[ESPÓLIO PENDENTE] A fração de [X] pertencente a [NOME DO FALECIDO] está sem titular registrado. Necessário inventário e averbação dos herdeiros antes do georreferenciamento." }

PASSO 4 — PRECEDÊNCIA ABSOLUTA: Um ato de óbito averbado SEMPRE cancela a titularidade anterior, independentemente de qual ato constituiu a propriedade. Proprietário falecido NUNCA aparece em owners.

EXEMPLO: matrícula onde R.22 atribuiu 3/6 a Aparecida Bottan da Silva e AV.25 registrou falecimento em 22/08/2023 — Aparecida NÃO deve constar em owners. Gerar alerta de falecimento (AV.25) e alerta de espólio pendente (3/6).`;

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

function deduplicateConjuges(proprietarios: any[]): any[] {
  if (!proprietarios || proprietarios.length < 2) return proprietarios;
  const normalized = (s: string | null | undefined) =>
    (s ?? '').replace(/\D/g, '').trim().toUpperCase();
  const result: any[] = [];
  const removedIndexes = new Set();
  for (let i = 0; i < proprietarios.length; i++) {
    if (removedIndexes.has(i)) continue;
    const a = proprietarios[i];
    const aConjugeCpf = normalized(a.conjuge_cpf);
    const aConjugeNome = (a.conjuge_nome ?? '').trim().toUpperCase();
    for (let j = i + 1; j < proprietarios.length; j++) {
      if (removedIndexes.has(j)) continue;
      const b = proprietarios[j];
      const bCpf = normalized(b.cpf);
      const bNome = (b.nome ?? '').trim().toUpperCase();
      const conjugeMatch =
        (aConjugeCpf && bCpf && aConjugeCpf === bCpf) ||
        (aConjugeNome && bNome && aConjugeNome === bNome);
      if (conjugeMatch) {
        if (!a.conjuge_cpf && b.cpf) a.conjuge_cpf = b.cpf;
        if (!a.conjuge_nome && b.nome) a.conjuge_nome = b.nome;
        if (!a.conjuge_rg && b.rg) a.conjuge_rg = b.rg;
        removedIndexes.add(j);
        break;
      }
    }
    result.push(a);
  }
  return result;
}

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
      { type: "text", text: "Analise esta matrícula de IMÓVEL CONFRONTANTE seguindo rigorosamente as regras do system prompt. Foco: APENAS proprietário(s) atual(is) e identificação do imóvel. NÃO extraia ônus, hipotecas ou alertas." },
      { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } },
    ];

    // 1) Primeira chamada
    const content1 = await callAI(lovableApiKey, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ]);

    let parsed = tryParseJson(content1);
    let tentativas = 1;
    if (!parsed || typeof parsed !== "object") {
      console.error("Parse falhou na 1ª chamada:", content1.slice(0, 400));
      parsed = {
        denominacao_imovel: null, matricula_numero: null, ccir: null, ccir_fonte: "nao_encontrado",
        municipio: null, uf: null, comarca: null, cartorio: null, area_hectares: null,
        proprietarios_atuais: [],
        campos_incertos: ["todos"],
      };
    }

    // F4 — Retry automático quando o retorno está completamente vazio
    // (denominação null, ccir null, e nenhum proprietário com nome).
    const propsArr0 = Array.isArray(parsed.proprietarios_atuais) ? parsed.proprietarios_atuais : [];
    const isCompletelyEmpty =
      !parsed.denominacao_imovel &&
      !parsed.ccir &&
      (propsArr0.length === 0 || propsArr0.every((p: any) => !p?.nome));

    if (isCompletelyEmpty) {
      console.log("F4: 1ª chamada veio vazia, executando retry com prompt de fallback");
      const fallbackInstruction = "A análise anterior retornou campos vazios. O documento pode ter qualidade baixa, marca d'água intensa ou formatação não convencional. Tente novamente com máxima atenção ao texto disponível. Extraia qualquer dado legível, mesmo que parcial. Para campos que não for possível ler com certeza, use '[ilegível]' em vez de null.";
      try {
        const content2 = await callAI(lovableApiKey, [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: `Analise esta matrícula de IMÓVEL CONFRONTANTE seguindo rigorosamente as regras do system prompt. ${fallbackInstruction}` },
              { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } },
            ],
          },
        ]);
        const parsed2 = tryParseJson(content2);
        if (parsed2 && typeof parsed2 === "object") {
          parsed = parsed2;
        }
        tentativas = 2;
      } catch (err) {
        console.error("F4: retry falhou:", err);
        tentativas = 2;
      }
    }

    // Normaliza — REMOVIDOS: alertas, hipotecas e qualquer campo de ônus
    parsed.proprietarios_atuais = Array.isArray(parsed.proprietarios_atuais) ? parsed.proprietarios_atuais : [];
    parsed.campos_incertos = Array.isArray(parsed.campos_incertos) ? parsed.campos_incertos : [];
    if (!parsed.ccir_fonte) parsed.ccir_fonte = parsed.ccir ? "ccir" : "nao_encontrado";
    parsed.tentativas = tentativas;
    // Remove explicitamente campos de ônus que a IA possa retornar por hábito
    delete parsed.alertas;
    delete parsed.hipotecas;
    delete parsed.alienacoes_fiduciarias;
    delete parsed.penhoras;
    delete parsed.servidoes;
    delete parsed.onus;

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

    if (parsed.proprietarios_atuais) {
      parsed.proprietarios_atuais = deduplicateConjuges(parsed.proprietarios_atuais);
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
