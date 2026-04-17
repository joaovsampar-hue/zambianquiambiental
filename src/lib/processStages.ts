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

// Validação simples de CAR (formato XX-XXXXXXX-XXXX.XXXX.XXXX.XXXX.XXXX)
export const CAR_REGEX = /^[A-Z]{2}-\d{7}-[0-9A-F]{4}\.[0-9A-F]{4}\.[0-9A-F]{4}\.[0-9A-F]{4}\.[0-9A-F]{4}$/i;
export const isValidCAR = (s: string) => CAR_REGEX.test(s.trim());

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
