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

A denominação do imóvel pode ter sido alterada ao longo dos anos por averbações. Para o campo 'identification.denomination', use SEMPRE a denominação mais recente — ou seja, a que consta na última averbação de alteração de nome (expressões como 'passou a denominar-se', 'passa a ser denominado', 'nova denominação', 'denominação alterada para'). Se houver mais de uma averbação alterando o nome, prevalece a mais recente cronologicamente. Ignore denominações de averbações anteriores. Se não houver nenhuma averbação de alteração de nome, use a denominação do cabeçalho da matrícula.

INSTRUÇÃO 3 — IDENTIFICAÇÃO DO PROPRIETÁRIO ATUAL EM MATRÍCULAS COM MUITAS TRANSMISSÕES:
A matrícula pode conter dezenas de atos ao longo dos anos. Para o array "owners" (proprietários atuais), retorne SOMENTE os últimos adquirentes de cada fração do imóvel — ou seja, aqueles que constam como compradores, donatários ou herdeiros em um ato sem que exista ato posterior transferindo a mesma fração a outra pessoa. Ignore todos os transmitentes e adquirentes intermediários. Se houver dúvida sobre quem é o atual titular de uma fração específica, retorne o dado com o campo adicional "verificar_titularidade": true dentro do objeto do proprietário. Nunca retorne como proprietário atual alguém que já conste como vendedor ou transmitente em ato posterior da mesma matrícula.

Quando a titularidade de uma fração resultar de formal de partilha ou inventário, extraia a participação de cada herdeiro conforme declarado no ato — ex: '1/6 (um sexto)', '3/6 (três sextos)', '50%'. Preencha o campo share_percentage de cada proprietário com esse valor. Se a matrícula usa frações (ex: 1/6), converta para percentual aproximado ou mantenha a fração — ex: '1/6 (16,67%)'. Nunca deixe share_percentage vazio para herdeiros de partilha.

EXTRAÇÃO DE CONFRONTANTES NO FORMATO ANTIGO DE DIVISAS:
Matrículas anteriores a 1990 descrevem confrontações em texto corrido com rumos e distâncias, sem usar os pontos cardeais explicitamente. Para extrair os confrontantes, identifique os nomes de pessoas, fazendas, propriedades, cursos d'água e vias que aparecem como referências de divisa.

Padrões a reconhecer:
- 'divisa de [NOME]' ou 'divisa com [NOME]' → confrontante
- 'de propriedade de [NOME]' junto a uma divisa → confrontante
- 'marco na beira do [CORPO HÍDRICO]' → limite hídrico
- 'estrada da divisa da [FAZENDA]' → via/estrada confrontante
- 'até encontrar [REFERÊNCIA]' → ponto de divisa

Para a matrícula 6.420, o roteiro diz: 'começa na estrada da divisa da Fazenda São Luiz, de propriedade do Dr. Placido Rocha, seguindo por esta estrada na distância de 133 metros até um marco na divisa de Pedro Victor de Souza ou sucessores, daí defletindo à direita no rumo 89° 15' N.W., na distância de 3.900 metros até um marco na beira do Ribeirão Lageado'

Confrontantes corretos a extrair:
- north: 'Pedro Victor de Souza ou sucessores'
- west: 'Ribeirão Lageado'
- south: 'Ribeirão Lageado'  
- east: 'Fazenda São Luiz (Dr. Plácido Rocha)'

Aplicar este mesmo raciocínio para qualquer matrícula com roteiro em formato de rumos e distâncias.

REGRA ESPECIAL — INVENTÁRIO E ARROLAMENTO:
Quando um ato de registro for originado de inventário, arrolamento, formal de partilha ou sucessão causa mortis, o proprietário atual NÃO é o falecido — é quem recebeu os bens por partilha.

- O DE CUJUS é indicado por: 'dos bens deixados por óbito de', 'de cujus', 'falecido(a)', 'inventariado(a)', 'espólio de'. NUNCA entra em owners.
- Os ADQUIRENTES são: 'viúvo-meeiro', 'herdeiro(s)', 'legatário(s)', 'partilhado e atribuído a', 'coube ao herdeiro', 'adjudicado a'. Estes entram em owners com as respectivas frações declaradas no ato.
- O VIÚVO-MEEIRO recebe meação (50% do regime de comunhão) + parte da herança se houver. Usar o percentual exato declarado no ato.

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

CORRELAÇÃO OBRIGATÓRIA entre marriage_regime e vigencia_lei_divorcio:
- 'antes_da_vigencia_6515' → o regime PADRÃO da época era comunhão UNIVERSAL de bens. Se a matrícula não especificou o regime explicitamente e o casamento é anterior a 26/12/1977, o regime deve ser 'comunhão universal de bens'. NUNCA retorne 'comunhão parcial de bens' com vigencia 'antes_da_vigencia_6515' — isso é juridicamente impossível pois a comunhão parcial como regime padrão só existe a partir da Lei 6.515/77.
- 'vigencia_6515' ou 'vigencia_cc2002' → regime padrão é comunhão PARCIAL.
- Se a matrícula declara explicitamente 'comunhão universal' para casamento após 26/12/1977, isso é válido pois exige pacto antenupcial — manter como declarado e usar o vigencia correto pelo período.

Exemplos corretos:
✓ comunhão universal + antes_da_vigencia_6515
✓ comunhão parcial + vigencia_6515
✓ comunhão universal + vigencia_6515 (com pacto antenupcial)
✗ comunhão parcial + antes_da_vigencia_6515 (IMPOSSÍVEL — corrigir para comunhão universal)

Quando a matrícula declarar 'comunhão de bens, anteriormente à vigência da Lei nº 6.515/77' ou variações similares ('comunhão universal de bens, anterior à Lei 6.515', 'sob regime de comunhão, antes da Lei do Divórcio'):
- marriage_regime: 'comunhão universal de bens (anterior à Lei 6.515/77 — CC/1916)'
- vigencia_lei_divorcio: 'antes_da_vigencia_6515'
Esta leitura direta tem precedência sobre o fallback por data.



INSTRUÇÃO 6 — ÔNUS REAIS — IDENTIFICAÇÃO DE STATUS (HIPOTECAS, ALIENAÇÕES FIDUCIÁRIAS E PENHORAS):
Para CADA ônus real encontrado (hipoteca, alienação fiduciária e penhora), verifique se existe ato posterior de cancelamento, baixa, quitação ou liberação na mesma matrícula que faça referência ao número do ato, livro ou folha do ônus original. Quando houver mais de um ônus do mesmo tipo, retorne o respectivo campo SEMPRE como ARRAY de objetos no formato: [{ "descricao": "...", "ato_origem": "...", "status_<tipo>": "ativa" | "cancelada" | "indefinida", "ato_cancelamento": "..." | null }]. O campo de status segue a convenção: hipoteca → "status_hipoteca"; alienação fiduciária → "status_fiduciaria"; penhora → "status_penhora".

REGRA DE STATUS — OBRIGATÓRIA E SEM EXCEÇÕES:

PASSO 1: Para cada ônus (R.X), leia TODAS as páginas e averbações do documento procurando referência a esse número de registro.

PASSO 2 — DECISÃO:
→ Se ato_cancelamento foi preenchido com qualquer valor ≠ null:
  status DEVE ser 'cancelada'. SEM EXCEÇÃO.
  A presença do ato_cancelamento É a prova do cancelamento.
→ Se não encontrou nenhuma averbação de cancelamento em todo o documento:
  status = 'ativa'
→ Se documento ilegível/incompleto e impossível determinar:
  status = 'indefinida'

REGRA DE OURO: ato_cancelamento preenchido = status 'cancelada'.
Nunca retorne ato_cancelamento preenchido com status 'indefinida' ou 'ativa'.

DISTINÇÃO REGISTRO vs AVERBAÇÃO:
Ônus reais são constituídos por REGISTROS (R.X). Averbações (AV.X) cancelam ou modificam — nunca constituem ônus. Se aparecer apenas AV. sem R. correspondente para um ônus, trata-se de cancelamento, não de novo ônus.

Reconheça como cancelamento de hipoteca ou cédula rural hipotecária qualquer um destes atos posteriores ao registro: averbação de cancelamento por instrumento particular autorizado pelo credor, baixa por liquidação da dívida, cancelamento por mandado judicial de quitação, ou qualquer averbação que mencione 'liquidação da dívida', 'cancelamento do R.', 'autorizado o cancelamento', 'em virtude da liquidação'. Cédula Rural Hipotecária e Cédula de Crédito Rural têm o mesmo tratamento de hipoteca para fins de status.

INSTRUÇÃO 7 — REGIME DE CASAMENTO E ENQUADRAMENTO LEGISLATIVO:

O campo vigencia_lei_divorcio deve refletir o enquadramento legal do casamento em um dos três períodos históricos da legislação brasileira de regime de bens. Os valores possíveis agora são:
- 'antes_da_vigencia_6515': casamento sob o Código Civil de 1916 (antes de 26/12/1977) — regime padrão era comunhão universal de bens (anterior à Lei 6.515/77 — CC/1916)
- 'vigencia_6515': casamento sob a Lei 6.515/77 (de 26/12/1977 a 10/01/2003) — regime padrão passou a ser comunhão parcial de bens (na vigência da Lei 6.515/77)
- 'vigencia_cc2002': casamento sob o Código Civil de 2002 — Lei 10.406/2002 (a partir de 11/01/2003) — mantém comunhão parcial como padrão (na vigência do CC/2002 — Lei 10.406/2002); separação obrigatória para maiores de 70 anos (após Lei 12.344/2010)
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
- Verificar se houver formal de partilha ou inventário posterior ao óbito para a fração dele. Se sim, os novos titulares entram em owners with suas respectivas frações.
- Gerar alerta: { "severity": "critical", "message": "[FALECIMENTO] O proprietário [NOME] consta como falecido na matrícula conforme [NÚMERO DA AVERBAÇÃO]. Data: [DATA SE DISPONÍVEL]. Fração afetada: [X]." }

PASSO 3: Se a fração do falecido não tiver novo titular registrado:
- Gerar segundo alerta: { "severity": "critical", "message": "[ESPÓLIO PENDENTE] A fração de [X] pertencente a [NOME DO FALECIDO] está sem titular registrado. Necessário inventário e averbação dos herdeiros antes do georreferenciamento." }

PASSO 4 — PRECEDÊNCIA ABSOLUTA: Um ato de óbito averbado SEMPRE cancela a titularidade anterior, independentemente de qual ato constituiu a propriedade. Proprietário falecido NUNCA aparece em owners.

EXEMPLO: matrícula onde R.22 atribuiu 3/6 a Aparecida Bottan da Silva e AV.25 registrou falecimento em 22/08/2023 — Aparecida NÃO deve constar em owners. Gerar alerta de falecimento (AV.25) e alerta de espólio pendente (3/6).

INSTRUÇÃO 11 — USUFRUTO, NU-PROPRIEDADE E PAPÉIS COMBINADOS:

REGRA FUNDAMENTAL DA INSTRUÇÃO 11:
O usufrutuário DEVE ser incluído no array owners com todos os seus dados completos (nome, CPF, RG, estado civil, regime de casamento, cônjuge). Não retorne o usufrutuário apenas como alerta — ele DEVE aparecer em owners. O campo role: 'usufrutuario' o distingue dos proprietários plenos. O alerta de [USUFRUTO ATIVO] é ADICIONAL ao campo owners, não substituto.

Da mesma forma, o nu-proprietário que também tem fração plena DEVE ter:
- role: 'nu_proprietario_e_proprietario_pleno'
- share_nu_propriedade preenchido
- share_propriedade_plena preenchido
- share_percentage = soma das duas frações

Estes campos são OBRIGATÓRIOS quando houver usufruto na matrícula.

Quando encontrar doação com reserva de usufruto ou constituição de usufruto (palavras-chave: 'com reserva de usufruto', 'reservou para si o usufruto vitalício', 'USUFRUTUÁRIO:', 'NÚ-PROPRIETÁRIO:', 'usufruto vitalício sobre as partes ideais'):

Para o DOADOR que reservou usufruto:
- role: 'usufrutuario'
- share_percentage: percentual do usufruto
- share_usufruto: mesmo valor
- usufruto_tipo: 'vitalicio' ou 'temporario'
- usufruto_ato: número do ato (ex: 'R.3-M/6.420')

Para o DONATÁRIO que recebeu com ônus de usufruto:
- Se só recebeu por doação: role: 'nu_proprietario', share_nu_propriedade: percentual recebido
- Se também tem fração por herança/compra sem usufruto: role: 'nu_proprietario_e_proprietario_pleno', share_nu_propriedade: fração com usufruto, share_propriedade_plena: fração sem usufruto, share_percentage: total das duas frações

Gerar alerta:
{ 'severity': 'info', 'message': '[USUFRUTO ATIVO] [NOME] possui usufruto [vitalício/temporário] sobre [X%] do imóvel conforme [ATO]. Para o georreferenciamento SIGEF, Nu-Proprietário e Usufrutuário devem assinar a documentação em conjunto.' }

EXEMPLO GENÉRICO de usufruto com doação:
- DOADOR (reservou usufruto para si): role: 'usufrutuario', share_percentage: '50%', share_usufruto: '50%', usufruto_tipo: 'vitalicio', usufruto_ato: 'R.X-M/XXXXX'
- DONATÁRIO (recebeu nua-propriedade + tem fração plena por herança): role: 'nu_proprietario_e_proprietario_pleno', share_nu_propriedade: '50%', share_propriedade_plena: '50%', share_percentage: '100%'

INSTRUÇÃO 13 — Usufrutuário: quem detém o direito de uso, não necessariamente quem institui:
Existem dois padrões de usufruto — leia o texto com atenção para identificar qual é o caso:

PADRÃO A — Doador reserva para si: "fulano doa, reservando para si o usufruto vitalício"
→ usufrutuário = fulano (o doador reservou o uso para ele mesmo)
→ nu-proprietário = quem recebeu a doação

PADRÃO B — Usufruto constituído em favor de terceiro: "fulano constitui usufruto em favor de beltrano"
→ usufrutuário = beltrano (quem recebeu o benefício)
→ nu-proprietário ou proprietário pleno = fulano

NUNCA assuma automaticamente que o doador ou o instituidor é o usufrutuário — leia qual padrão se aplica ao ato específico.

INSTRUÇÃO 14 — CPF e RG pertencem ao bloco imediatamente anterior:
Cada CPF ou RG encontrado no documento deve ser associado SOMENTE ao nome que aparece no mesmo parágrafo ou bloco textual. Nunca carregue um documento identificador para um proprietário diferente do bloco onde foi encontrado. Em caso de ambiguidade, retorne null para o campo em questão.

INSTRUÇÃO 15 — VIUVEZ TEM PRECEDÊNCIA ABSOLUTA SOBRE ESTADO CIVIL DO ATO:
Antes de registrar o estado civil de qualquer proprietário, varra TODO o documento incluindo: atos de aquisição, averbações, campo Observações e qualquer texto livre, em busca dos termos: "viúvo", "viúva", "em estado de viuvez", "falecido seu cônjuge", "falecida sua cônjuge", "viúvo(a) meeiro(a)", averbação de óbito do cônjuge, ou qualquer menção a falecimento do cônjuge em qualquer parte do documento.
Se qualquer um desses termos for encontrado associado a um proprietário em QUALQUER PONTO do documento, o estado civil DEVE ser obrigatoriamente "viúvo" ou "viúva".
Esta regra tem precedência absoluta sobre o estado civil declarado no ato de aquisição, mesmo que o ato diga "casado(a)".
Nunca retorne "casado" ou "casada" para uma pessoa cujo cônjuge conste como falecido em qualquer parte do documento.

INSTRUÇÃO 16 — Cônjuge não pode ser reutilizado entre proprietários:
O campo cônjuge de cada proprietário deve ser preenchido SOMENTE com o cônjuge declarado no mesmo ato ou bloco daquele proprietário específico. É terminantemente proibido atribuir o cônjuge de um proprietário a outro proprietário. Se o cônjuge não for mencionado explicitamente junto ao proprietário em questão, retorne null para esse campo.

INSTRUÇÃO 17 — Denominação do imóvel: atenção a nomes de santos e topônimos:
Ao extrair a denominação do imóvel, leia com atenção especial nomes compostos, especialmente os que começam com "São", "Santa", "Santo", "Nossa Senhora" e similares. Nunca fragmente o nome do imóvel. Se o texto estiver ilegível, busque o nome em outros atos do mesmo documento que referenciem o imóvel. Exemplo de erro a evitar: ler "Sítio São José" como "Sítio João Sé".

INSTRUÇÃO 18 — Três períodos legislativos para regime de casamento (reforço da instrução 7):
Ao determinar o regime de casamento, siga obrigatoriamente:
- Casamento ANTERIOR a 26/12/1977: regime padrão presumido é COMUNHÃO UNIVERSAL DE BENS (CC/1916, antes da Lei 6.515/77). Retorne: "comunhão universal de bens (anterior à Lei 6.515/77 — CC/1916)"
- Casamento entre 26/12/1977 e 10/01/2003: regime padrão presumido é COMUNHÃO PARCIAL DE BENS (na vigência da Lei 6.515/77). Retorne: "comunhão parcial de bens (na vigência da Lei 6.515/77)"
- Casamento APÓS 10/01/2003: regime padrão presumido é COMUNHÃO PARCIAL DE BENS (na vigência do CC/2002). Retorne: "comunhão parcial de bens (na vigência do CC/2002 — Lei 10.406/2002)"

O texto explícito do documento tem SEMPRE precedência sobre a data inferida. Se o documento declarar o regime expressamente, use o declarado.

INSTRUÇÃO 19 — CPF e RG pertencem ao titular, nunca ao cônjuge:
O CPF e o RG do cônjuge devem ser preenchidos SOMENTE com documentos explicitamente declarados como sendo do cônjuge no texto.
É PROIBIDO copiar o CPF ou RG do proprietário principal para o campo do cônjuge.
Se o documento do cônjuge não estiver declarado no texto, retorne null nesses campos.
Nunca reutilize o mesmo número de CPF ou RG para proprietário e cônjuge simultaneamente.

INSTRUÇÃO 20 — Atos anulados, cancelados ou revertidos não geram proprietários atuais:
Ao identificar proprietários pela Instrução 3, verifique se o ato de aquisição foi posteriormente ANULADO, CANCELADO ou REVERTIDO por ato posterior registrado na mesma matrícula.
Sinais de anulação: "fica sem efeito", "anulado por", "declarado nulo", "cancelado o registro", "revertido ao", "voltou a", "retornou para", "foi anulada a transferência".
Se um ato de doação ou transmissão foi anulado, os adquirentes daquele ato NÃO são proprietários atuais.
Atenção especial ao campo Observações: se ele descrever uma sequência de atos e reversões, use apenas a situação jurídica final descrita.
`;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const googleApiKey = Deno.env.get("GOOGLE_API_KEY");
    if (!googleApiKey) throw new Error("GOOGLE_API_KEY not configured");

    // ── AUTH: verify JWT before any AI/storage work to prevent
    // unauthenticated callers from draining credits or extracting PDFs.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { analysisId, pdfPath, imagePaths } = await req.json();

    const supabase = createClient(supabaseUrl, supabaseKey);

    // The client rasterizes the PDF to JPEGs and uploads them to storage.
    // Gemini accepts JPEG/PNG via signed URL natively (no base64 needed),
    // so we never load the PDF into edge memory.
    if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
      return new Response(
        JSON.stringify({ error: "imagePaths é obrigatório (array de caminhos de imagens das páginas)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    // Defense-in-depth: every supplied path must live under the authenticated
    // user's prefix in the matriculas bucket. Prevents an attacker from
    // guessing other users' file paths to extract their content via the AI.
    for (const p of imagePaths) {
      if (typeof p !== "string" || !p.startsWith(`${userId}/`)) {
        return new Response(JSON.stringify({ error: "Forbidden: path not owned by user" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    if (pdfPath && (typeof pdfPath !== "string" || !pdfPath.startsWith(`${userId}/`))) {
      return new Response(JSON.stringify({ error: "Forbidden: pdfPath not owned by user" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const signedUrls: string[] = [];
    for (const path of imagePaths) {
      const { data: s, error: sErr } = await supabase.storage
        .from("matriculas")
        .createSignedUrl(path, 60 * 15);
      if (sErr || !s?.signedUrl) throw sErr ?? new Error(`Failed to sign ${path}`);
      signedUrls.push(s.signedUrl);
    }
    console.log(`process-matricula: ${signedUrls.length} page image(s) signed`);

    const buildContent = (text: string) => [
      { 
        type: "text", 
        text: `ATENÇÃO: Esta é uma análise completamente independente e isolada.
Ignore qualquer contexto de matrículas analisadas anteriormente nesta sessão.
Os dados desta matrícula não têm relação com nenhum imóvel analisado antes.
Extraia SOMENTE os dados presentes nas imagens fornecidas abaixo.
Se um nome, CPF ou imóvel não aparecer nestas imagens, NÃO o inclua na resposta.

${text}` 
      },
      ...signedUrls.map((url) => ({ type: "image_url", image_url: { url } })),
    ];

    // Send to Google AI Studio API (OpenAI-compatible endpoint)
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${googleApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: buildContent(
              "Analise esta matrícula de imóvel rural. As imagens estão em ORDEM SEQUENCIAL de páginas — trate-as como um documento único contínuo.\n\nATENÇÃO ESPECIAL AOS SEGUINTES PONTOS:\n\n1. HIPOTECAS E CANCELAMENTOS: cada Registro (R.X) de hipoteca pode ter seu cancelamento em uma Averbação (AV.Y) em página posterior. Leia TODAS as páginas antes de determinar o status. Se encontrar 'AV.Y' que menciona cancelamento, baixa ou liquidação referente a 'R.X', marque R.X como cancelada com ato_cancelamento: 'AV.Y'. Só marque como 'ativa' se não houver NENHUMA averbação de cancelamento em todo o documento.\n\n2. CONFRONTANTES: o roteiro perimétrico pode usar tanto o formato moderno (sentido dos azimutes) quanto o formato antigo ('confronta ao norte com X, ao sul com Y, ao leste com Z, ao oeste com W'). Em AMBOS os casos, extraia os nomes dos confrontantes para os campos north/south/east/west e transcreva o texto completo em boundaries.roteiro. Confrontantes típicos: nomes de pessoas, denominações de fazendas/sítios, estradas, córregos, ribeirões.\n\n3. DOCUMENTOS ANTIGOS: matrículas anteriores a 1990 podem ter texto datilografado com baixa qualidade OCR. Faça o máximo esforço para ler abreviações e texto parcialmente ilegível.\n\nExtraia todos os dados no formato JSON especificado.",
            ),
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Google API error (${response.status}):`, errorText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições excedido no Google AI Studio. Tente novamente em alguns minutos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402 || response.status === 403) {
        return new Response(JSON.stringify({ error: "Erro de permissão ou cota na API do Google. Verifique o Google AI Studio.", details: errorText }), {
          status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `Erro na API do Google (${response.status})`, details: errorText }), {
        status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawText = await response.text();
    let aiResponse: any = null;
    if (rawText && rawText.trim()) {
      try {
        aiResponse = JSON.parse(rawText);
      } catch (parseErr) {
        console.error("Failed to parse AI Gateway response:", rawText.slice(0, 500));
      }
    } else {
      console.error("AI Gateway returned empty body (status", response.status, ") — will fallback to gemini-2.5-pro");
    }
    const content = aiResponse?.choices?.[0]?.message?.content ?? "";

    const tryParse = (raw: string) => {
      try {
        const m = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/\{[\s\S]*\}/);
        return JSON.parse(m ? (m[1] || m[0]) : raw);
      } catch { return null; }
    };

    let parsed = tryParse(content);

    // Retry quando parse falhou, owners vazios OU conteúdo vazio (gateway truncado)
    const ownersEmpty = !parsed || !Array.isArray(parsed.owners) ||
      parsed.owners.length === 0 ||
      parsed.owners.every((o: any) => !o?.name);
    const contentEmpty = !content || !content.trim();

    if (ownersEmpty || contentEmpty) {
      console.log(`process-matricula: 1ª chamada inadequada (contentEmpty=${contentEmpty}, ownersEmpty=${ownersEmpty}), executando retry com gemini-2.5-pro`);
      const retryResp = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${googleApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-2.5-pro",
          temperature: 0,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: buildContent(
                "A análise anterior retornou campos vazios ou incompletos. Tente novamente com atenção máxima ao texto. Analise esta matrícula de imóvel rural. As imagens estão em ORDEM SEQUENCIAL de páginas — trate-as como um documento único contínuo.\n\nATENÇÃO ESPECIAL AOS SEGUINTES PONTOS:\n\n1. HIPOTECAS E CANCELAMENTOS: cada Registro (R.X) de hipoteca pode ter seu cancelamento em uma Averbação (AV.Y) em página posterior. Leia TODAS as páginas antes de determinar o status. Se encontrar 'AV.Y' que menciona cancelamento, baixa ou liquidação referente a 'R.X', marque R.X como cancelada com ato_cancelamento: 'AV.Y'. Só marque como 'ativa' se não houver NENHUMA averbação de cancelamento em todo o documento.\n\n2. CONFRONTANTES: o roteiro perimétrico pode usar tanto o formato moderno (sentido dos azimutes) quanto o formato antigo ('confronta ao norte com X, ao sul com Y, ao leste com Z, ao oeste com W'). Em AMBOS os casos, extraia os nomes dos confrontantes para os campos north/south/east/west e transcreva o texto completo em boundaries.roteiro. Confrontantes típicos: nomes de pessoas, denominações de fazendas/sítios, estradas, córregos, ribeirões.\n\n3. DOCUMENTOS ANTIGOS: matrículas anteriores a 1990 podem ter texto datilografado com baixa qualidade OCR. Faça o máximo esforço para ler abreviações e texto parcialmente ilegível.\n\nExtraia todos os dados no formato JSON especificado.",
              ),
            },
          ],
        }),
      });
      if (retryResp.ok) {
        const retryRaw = await retryResp.text();
        if (retryRaw && retryRaw.trim()) {
          try {
            const retryJson = JSON.parse(retryRaw);
            const retryContent = retryJson.choices?.[0]?.message?.content ?? "";
            const retryParsed = tryParse(retryContent);
            if (retryParsed && typeof retryParsed === "object") {
              parsed = retryParsed;
            }
          } catch (e) {
            console.error("Retry parse failed:", retryRaw.slice(0, 300));
          }
        } else {
          console.error("Retry returned empty body");
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

    // Pós-processamento: garantir que ato_cancelamento preenchido = status cancelada
    const fixEncumbranceStatus = (items: any[], statusKey: string) => {
      if (!Array.isArray(items)) return items;
      return items.map(item => {
        if (!item || typeof item !== 'object') return item;
        const hasCancel = item.ato_cancelamento &&
          item.ato_cancelamento !== null &&
          item.ato_cancelamento !== '' &&
          item.ato_cancelamento !== '—';
        if (hasCancel && item[statusKey] !== 'cancelada') {
          return { ...item, [statusKey]: 'cancelada' };
        }
        return item;
      });
    };

    const enc = extracted_data.encumbrances;
    if (enc) {
      if (Array.isArray(enc.mortgage)) {
        enc.mortgage = fixEncumbranceStatus(enc.mortgage, 'status_hipoteca');
      }
      if (Array.isArray(enc.fiduciary_alienation)) {
        enc.fiduciary_alienation = fixEncumbranceStatus(enc.fiduciary_alienation, 'status_fiduciaria');
      }
      if (Array.isArray(enc.seizure)) {
        enc.seizure = fixEncumbranceStatus(enc.seizure, 'status_penhora');
      }
    }

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
