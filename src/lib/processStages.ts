export const STAGES = [
  { key: 'identificacao', label: 'Identificação' },
  { key: 'mapa', label: 'Mapa & Confrontantes' },
  { key: 'matricula', label: 'Matrícula' },
  { key: 'anuencias', label: 'Anuências' },
  { key: 'ccir', label: 'CCIR' },
  { key: 'revisao', label: 'Revisão pré-cartório' },
  { key: 'cartorio', label: 'Enviado ao cartório' },
  { key: 'concluido', label: 'Concluído' },
] as const;

export const SERVICE_TYPES = [
  { key: 'georreferenciamento', label: 'Georreferenciamento' },
  { key: 'certificacao', label: 'Certificação' },
  { key: 'desmembramento', label: 'Desmembramento' },
  { key: 'remembramento', label: 'Remembramento' },
  { key: 'retificacao', label: 'Retificação' },
] as const;

export const stageLabel = (k: string) => STAGES.find(s => s.key === k)?.label ?? k;
export const serviceLabel = (k: string) => SERVICE_TYPES.find(s => s.key === k)?.label ?? k;

// CAR SICAR: aceito com ou sem pontos. Sanitização remove "." antes de validar.
// Formato canônico (sem pontos): UF + "-" + 7 dígitos + "-" + 32 hex.
export const sanitizeCAR = (s: string) => s.replace(/\./g, '').trim().toUpperCase();
export const CAR_REGEX = /^[A-Z]{2}-\d{7}-[0-9A-F]{32}$/;
export const isValidCAR = (s: string) => {
  if (!s) return false;
  return CAR_REGEX.test(sanitizeCAR(s));
};
// Extrai UF (sigla estadual) do CAR para centralização do mapa
export const carUF = (s: string): string | null => {
  const m = sanitizeCAR(s).match(/^([A-Z]{2})-/);
  return m ? m[1] : null;
};

// Centróides aproximados das UFs brasileiras (WGS84) — para zoom inicial do mapa
export const UF_CENTERS: Record<string, [number, number, number]> = {
  // [lat, lng, zoom]
  AC: [-9.0238, -70.812, 7], AL: [-9.5713, -36.782, 8], AP: [1.4144, -51.78, 7],
  AM: [-3.4168, -65.856, 6], BA: [-12.5797, -41.7007, 6], CE: [-5.4984, -39.32, 7],
  DF: [-15.7998, -47.8645, 9], ES: [-19.1834, -40.3089, 8], GO: [-15.827, -49.836, 6],
  MA: [-4.9609, -45.2744, 6], MT: [-12.6819, -56.9211, 6], MS: [-20.7722, -54.7852, 6],
  MG: [-18.5122, -44.555, 6], PA: [-3.79, -52.4806, 6], PB: [-7.24, -36.782, 8],
  PR: [-25.2521, -52.0215, 7], PE: [-8.8137, -36.9541, 7], PI: [-7.7183, -42.7289, 7],
  RJ: [-22.9099, -43.2095, 8], RN: [-5.4026, -36.9541, 8], RS: [-30.0346, -53.5, 6],
  RO: [-11.5057, -63.5806, 7], RR: [2.7376, -62.0751, 7], SC: [-27.2423, -50.2189, 7],
  SP: [-22.5, -48.5, 7], SE: [-10.5741, -37.3857, 8], TO: [-10.25, -48.25, 7],
};

export const consentLabels: Record<string, string> = {
  nao_iniciado: 'Não iniciado',
  contato_enviado: 'Contato enviado',
  aguardando: 'Aguardando retorno',
  assinada: 'Assinatura coletada',
  recusou: 'Recusou',
};

export const consentColors: Record<string, string> = {
  nao_iniciado: 'bg-muted text-muted-foreground',
  contato_enviado: 'bg-info/15 text-info',
  aguardando: 'bg-warning/15 text-warning',
  assinada: 'bg-success/15 text-success',
  recusou: 'bg-destructive/15 text-destructive',
};
