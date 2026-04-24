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
Este documento pode conter marcas d'água diagonais ou repetidas sobrepostas ao texto, com conteúdos como "VISUALIZAÇÃO ÚNICA", "CÓPIA NÃO AUTORIZADA", nome do cartório, data e hora de emissão, ou número de protocolo. Ignore completamente qualquer texto que faça parte da marca d'água — esses textos não são conteúdo jurídico da matrícula. Concentre-se exclusivamente no conteúdo da matrícula: cabeçalho, atos, averbações e transcrições. Se um campo de dado estiver parcialmente encoberto pela marca d'água, tente inferir o valor pelo contexto e indique esse campo com o sufixo "[inferido]" no valor retornado.

INSTRUÇÃO 2 — DOCUMENTOS ANTIGOS E DATILOGRAFADOS:
O documento pode ter sido produzido em máquina de escrever, com espaçamento irregular entre caracteres, abreviações de época (ex: Crs$ para cruzeiros, V.Exª, fls., R.I., Dr.ª, S/A), rasuras com correção sobreescrita, carimbos sobrepostos ao texto, numeração de folhas inserida no meio de frases e texto em caixa alta. Ao encontrar essas situações: normalize abreviações conhecidas para a forma completa; preserve números de documentos, matrículas e áreas EXATAMENTE como grafados — não corrija nem formate; para nomes em caixa alta, converta para formato nome próprio padrão; para valores monetários históricos, registre o valor e a moeda como constam sem conversão.

INSTRUÇÃO 2B — DENOMINAÇÃO ATUAL DO IMÓVEL:
A denominação do imóvel pode ter sido alterada ao longo dos anos por averbações. Para o campo identification.denomination, use SEMPRE a denominação mais recente — ou seja, a que consta na última averbação de alteração de nome. Se não houver nenhuma averbação de alteração de nome, use a denominação do cabeçalho da matrícula.

INSTRUÇÃO 3 — IDENTIFICAÇÃO DO PROPRIETÁRIO ATUAL EM MATRÍCULAS COM MUITAS TRANSMISSÕES:
A matrícula pode conter dezenas de atos ao longo dos anos. Para o array "owners" (proprietários atuais), retorne SOMENTE os últimos adquirentes de cada fração do imóvel — ou seja, those which constam como compradores, donatários ou herdeiros em um ato sem que exista ato posterior transferindo a mesma fração a outra pessoa. Ignore todos os transmitentes e adquirentes intermediários. Se houver dúvida sobre quem é o atual titular de uma fração específica, retorne o dado com o campo adicional "verificar_titularidade": true dentro do objeto do proprietário. Nunca retorne como proprietário atual alguém que já conste como vendedor ou transmitente em ato posterior da mesma matrícula.

Quando a titularidade de uma fração resultar de formal de partilha ou inventário, extraia a participação de cada herdeiro conforme declarado no ato — ex: '1/6 (um sexto)', '3/6 (três sextos)', '50%'. Preencha o campo share_percentage de cada proprietário com esse valor.

REGRA ESPECIAL — INVENTÁRIO E ARROLAMENTO:
Quando um ato de registro for originado de inventário, arrolamento, formal de partilha ou sucessão causa mortis, o proprietário atual NÃO é o falecido — é quem recebeu os bens por partilha. O DE CUJUS NUNCA entra em owners.

INSTRUÇÃO 3B — VERIFICAÇÃO OBRIGATÓRIA DE FALECIMENTO:
Para CADA proprietário identificado em owners, varrer imediatamente TODAS as averbações da matrícula do início ao fim buscando o nome desse proprietário junto com qualquer das expressões: 'falecimento', 'falecido', 'falecida', 'óbito', 'ocorreu o falecimento', 'certidão de óbito', 'de cujus', 'espólio de', 'espólio do', 'por ato de ofício', 'comunicamos o falecimento', 'em virtude do falecimento'. Se encontrar averbação de óbito de um proprietário listado em owners: remover esse proprietário COMPLETAMENTE de owners. Gerar alertas críticos de falecimento e espólio pendente.

INSTRUÇÃO 4 — BUSCA DE DADOS DOCUMENTAIS EM ATOS ANTERIORES:
Para cada proprietário atual identificado, extraia CPF, RG e órgão emissor. Se esses dados não estiverem no último ato de transmissão, pesquise em TODOS os atos anteriores da mesma matrícula. Quando os dados vierem de um ato anterior, adicione o campo "fonte_dados_documentais": "averbacao_anterior" no objeto desse proprietário.

INSTRUÇÃO 5 — ESTADO CIVIL, REGIME DE CASAMENTO E CÔNJUGE:
Para cada proprietário, extraia o estado civil declarado no ato de aquisição ou em averbação posterior. Se o proprietário for casado, extraia também: nome completo do cônjuge, CPF do cônjuge quando mencionado, RG do cônjuge quando mencionado, e regime de bens.

CORRELAÇÃO OBRIGATÓRIA entre marriage_regime e vigencia_lei_divorcio:
- 'antes_da_vigencia_6515' → regime PADRÃO era comunhão UNIVERSAL de bens. NUNCA retorne 'comunhão parcial de bens' com vigencia 'antes_da_vigencia_6515'.
- 'vigencia_6515' ou 'vigencia_cc2002' → regime padrão é comunhão PARCIAL.

INSTRUÇÃO 6 — ÔNUS REAIS:
Para CADA ônus real encontrado, retorne como ARRAY de objetos no formato: [{ "descricao": "...", "ato_origem": "...", "status_hipoteca": "ativa" | "cancelada" | "indefinida", "ato_cancelamento": "..." | null }]. REGRA: ato_cancelamento preenchido = status OBRIGATORIAMENTE 'cancelada'.

INSTRUÇÃO 7 — REGIME DE CASAMENTO E ENQUADRAMENTO LEGISLATIVO:
- Casamento antes de 26/12/1977 → 'antes_da_vigencia_6515' → comunhão universal de bens (anterior à Lei 6.515/77 — CC/1916)
- Casamento de 26/12/1977 a 10/01/2003 → 'vigencia_6515' → comunhão parcial de bens (na vigência da Lei 6.515/77)
- Casamento após 10/01/2003 → 'vigencia_cc2002' → comunhão parcial de bens (na vigência do CC/2002 — Lei 10.406/2002)
O texto explícito do documento tem SEMPRE precedência sobre a data inferida.

INSTRUÇÃO 8 — CCIR E REGISTRO NO INCRA:
Pesquise também por: 'registrado no INCRA sob o número', 'cadastrado no INCRA', 'inscrição no INCRA nº'. Se encontrar, retorne no campo "identification.ccir" normalmente.

INSTRUÇÃO 9 — CASAL COMO PROPRIETÁRIO ÚNICO:
Quando dois proprietários do mesmo ato de aquisição forem casados entre si, NÃO os retorne como dois proprietários separados. Retorne SOMENTE O PRIMEIRO como proprietário principal, com o segundo no campo cônjuge. O campo share_percentage do proprietário A DEVE permanecer com o valor exato original.

INSTRUÇÃO 10 — VERIFICAÇÃO OBRIGATÓRIA DE FALECIMENTO:
Esta verificação deve ser executada APÓS identificar os proprietários atuais e ANTES de retornar o JSON. Proprietário falecido NUNCA aparece em owners.

INSTRUÇÃO 11 — USUFRUTO, NU-PROPRIEDADE E PAPÉIS COMBINADOS:
O usufrutuário DEVE ser incluído no array owners com todos os seus dados completos e role: 'usufrutuario'.

Existem dois padrões de usufruto:
PADRÃO A — Doador reserva para si: "fulano doa, reservando para si o usufruto vitalício" → usufrutuário = fulano
PADRÃO B — Usufruto em favor de terceiro: "fulano constitui usufruto em favor de beltrano" → usufrutuário = beltrano

Para o doador que reservou usufruto: role: 'usufrutuario', share_usufruto: percentual, usufruto_tipo: 'vitalicio' ou 'temporario', usufruto_ato: número do ato.
Para o donatário: role: 'nu_proprietario' ou 'nu_proprietario_e_proprietario_pleno' conforme o caso.

EXEMPLO GENÉRICO de usufruto com doação:
- DOADOR (reservou usufruto para si): role: 'usufrutuario', share_percentage: '50%', share_usufruto: '50%', usufruto_tipo: 'vitalicio', usufruto_ato: 'R.X-M/XXXXX'
- DONATÁRIO (recebeu nua-propriedade + tem fração plena por herança): role: 'nu_proprietario_e_proprietario_pleno', share_nu_propriedade: '50%', share_propriedade_plena: '50%', share_percentage: '100%'

INSTRUÇÃO 13 — Usufrutuário: quem detém o direito de uso, não necessariamente quem institui:
PADRÃO A — Doador reserva para si: "fulano doa, reservando para si o usufruto vitalício" → usufrutuário = fulano
PADRÃO B — Usufruto constituído em favor de terceiro: "fulano constitui usufruto em favor de beltrano" → usufrutuário = beltrano
NUNCA assuma automaticamente que o doador ou o instituidor é o usufrutuário — leia qual padrão se aplica ao ato específico.

INSTRUÇÃO 14 — CPF e RG pertencem ao bloco imediatamente anterior:
Cada CPF ou RG encontrado no documento deve ser associado SOMENTE ao nome que aparece no mesmo parágrafo ou bloco textual. Nunca carregue um documento identificador para um proprietário diferente do bloco onde foi encontrado. Em caso de ambiguidade, retorne null para o campo em questão.

INSTRUÇÃO 15 — VIUVEZ TEM PRECEDÊNCIA ABSOLUTA SOBRE ESTADO CIVIL DO ATO:
Antes de registrar o estado civil de qualquer proprietário, varra TODO o documento incluindo: atos de aquisição, averbações, campo Observações e qualquer texto livre, em busca dos termos: "viúvo", "viúva", "em estado de viuvez", "falecido seu cônjuge", "falecida sua cônjuge", "viúvo(a) meeiro(a)", averbação de óbito do cônjuge.
Se qualquer um desses termos for encontrado associado a um proprietário em QUALQUER PONTO do documento, o estado civil DEVE ser obrigatoriamente "viúvo" ou "viúva".
Esta regra tem precedência absoluta sobre o estado civil declarado no ato de aquisição, mesmo que o ato diga "casado(a)".

INSTRUÇÃO 16 — Cônjuge não pode ser reutilizado entre proprietários:
O campo cônjuge de cada proprietário deve ser preenchido SOMENTE com o cônjuge declarado no mesmo ato ou bloco daquele proprietário específico. É terminantemente proibido atribuir o cônjuge de um proprietário a outro proprietário. Se o cônjuge não for mencionado explicitamente junto ao proprietário em questão, retorne null para esse campo.

INSTRUÇÃO 17 — Denominação do imóvel: atenção a nomes de santos e topônimos:
Ao extrair a denominação do imóvel, leia com atenção especial nomes compostos, especialmente os que começam com "São", "Santa", "Santo", "Nossa Senhora" e similares. Nunca fragmente o nome do imóvel. Exemplo de erro a evitar: ler "Sítio São José" como "Sítio João Sé".

INSTRUÇÃO 18 — Três períodos legislativos para regime de casamento:
- Casamento ANTERIOR a 26/12/1977: regime padrão é COMUNHÃO UNIVERSAL DE BENS (CC/1916, antes da Lei 6.515/77)
- Casamento entre 26/12/1977 e 10/01/2003: regime padrão é COMUNHÃO PARCIAL DE BENS (na vigência da Lei 6.515/77)
- Casamento APÓS 10/01/2003: regime padrão é COMUNHÃO PARCIAL DE BENS (na vigência do CC/2002)
O texto explícito do documento tem SEMPRE precedência sobre a data inferida.

INSTRUÇÃO 19 — CPF e RG pertencem ao titular, nunca ao cônjuge:
O CPF e o RG do cônjuge devem ser preenchidos SOMENTE com documentos explicitamente declarados como sendo do cônjuge no texto. É PROIBIDO copiar o CPF ou RG do proprietário principal para o campo do cônjuge. Nunca reutilize o mesmo número de CPF ou RG para proprietário e cônjuge simultaneamente.

INSTRUÇÃO 20 — Atos anulados, cancelados ou revertidos não geram proprietários atuais:
Se um ato de doação ou transmissão foi anulado, os adquirentes daquele ato NÃO são proprietários atuais. Sinais de anulação: "fica sem efeito", "anulado por", "declarado nulo", "cancelado o registro", "revertido ao", "voltou a", "retornou para", "foi anulada a transferência". Atenção especial ao campo Observações: se ele descrever uma sequência de atos e reversões, use apenas a situação jurídica final descrita.`;

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
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
      }
      const base64 = btoa(binary);
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

    const fixEncumbranceStatus = (items: any[], statusKey: string) => {
      if (!Array.isArray(items)) return items;
      return items.map(item => {
        if (!item || typeof item !== 'object') return item;
        const hasCancel = item.ato_cancelamento && item.ato_cancelamento !== null && item.ato_cancelamento !== '' && item.ato_cancelamento !== '—';
        if (hasCancel && item[statusKey] !== 'cancelada') return { ...item, [statusKey]: 'cancelada' };
        return item;
      });
    };

    const enc = parsed.encumbrances;
    if (enc) {
      if (Array.isArray(enc.mortgage)) enc.mortgage = fixEncumbranceStatus(enc.mortgage, 'status_hipoteca');
      if (Array.isArray(enc.fiduciary_alienation)) enc.fiduciary_alienation = fixEncumbranceStatus(enc.fiduciary_alienation, 'status_fiduciaria');
      if (Array.isArray(enc.seizure)) enc.seizure = fixEncumbranceStatus(enc.seizure, 'status_penhora');
    }

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
