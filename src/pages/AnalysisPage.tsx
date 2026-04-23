import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Save, AlertTriangle, AlertCircle, Info, Bot, FileText, FileDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { exportToWord, exportToPdf } from '@/lib/exportAnalysis';
import BoundariesTab from '@/components/analysis/BoundariesTab';
import DeleteButton from '@/components/DeleteButton';

const getRoleBadge = (owner: any) => {
  switch (owner.role) {
    case 'nu_proprietario':
      return <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-300">Nu-Proprietário</span>;
    case 'usufrutuario':
      return <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">Usufrutuário</span>;
    case 'nu_proprietario_e_proprietario_pleno':
      return (
        <span className="ml-2 flex gap-1 inline-flex">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-800 border border-blue-300">Nu-Proprietário {owner.share_nu_propriedade}</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-800 border border-green-300">Proprietário Pleno {owner.share_propriedade_plena}</span>
        </span>
      );
    case 'proprietario_pleno':
    default:
      return null;
  }
};

export function deduplicateConjuges(proprietarios: any[]): any[] {
  if (!proprietarios || proprietarios.length < 2) return proprietarios;

  const normalized = (s: string | null | undefined) =>
    (s ?? '').replace(/\D/g, '').trim().toUpperCase();

  const result: any[] = [];
  const removedIndexes = new Set();

  for (let i = 0; i < proprietarios.length; i++) {
    if (removedIndexes.has(i)) continue;

    const a = { ...proprietarios[i] };
    const aCpf = normalized(a.cpf_cnpj);
    const aConjugeCpf = normalized(a.spouse?.cpf);
    const aConjugeNome = (a.spouse?.name ?? '').trim().toUpperCase();

    for (let j = i + 1; j < proprietarios.length; j++) {
      if (removedIndexes.has(j)) continue;

      const b = { ...proprietarios[j] };
      const bCpf = normalized(b.cpf_cnpj);
      const bNome = (b.name ?? '').trim().toUpperCase();

      const conjugeMatch =
        (aCpf && aConjugeCpf && aConjugeCpf === bCpf) ||
        (aConjugeNome && bNome && aConjugeNome === bNome);

      if (!conjugeMatch) continue;

      // Mesclar B como cônjuge de A — independente de B ter participação ou não.
      // Preservar dados completos de B (incluindo share_percentage) no cônjuge de A.
      if (!a.spouse) a.spouse = {};
      if (!a.spouse.name && b.name) a.spouse.name = b.name;
      if (!a.spouse.cpf && b.cpf_cnpj) a.spouse.cpf = b.cpf_cnpj;
      if (!a.spouse.rg && b.rg) a.spouse.rg = b.rg;
      // Preservar participação do cônjuge para exibição
      if (b.share_percentage) a.spouse.share_percentage = b.share_percentage;
      // Preservar dados extras do cônjuge
      if (b.marital_status) a.spouse.marital_status = b.marital_status;
      if (b.nationality) a.spouse.nationality = b.nationality;

      proprietarios[i] = a;
      removedIndexes.add(j);
      break;
    }
    result.push(proprietarios[i]);
  }

  return result;
}

function FieldWithAiIndicator({ label, value, onChange, required, multiline }: {
  label: string; value: unknown; onChange: (v: string) => void; required?: boolean; multiline?: boolean;
}) {
  // A IA pode devolver objetos/arrays/números para alguns campos (ex.: hipotecas
  // como array, status como boolean). Normalizamos para string antes de usar.
  const safeValue =
    value == null ? ''
    : typeof value === 'string' ? value
    : typeof value === 'number' || typeof value === 'boolean' ? String(value)
    : (() => { try { return JSON.stringify(value, null, 2); } catch { return String(value); } })();
  const hasAiValue = safeValue.trim().length > 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label className="text-xs">{label}{required && ' *'}</Label>
        {hasAiValue && <span title="Preenchido pela IA"><Bot className="w-3 h-3 text-primary" /></span>}
      </div>
      {multiline ? (
        <Textarea value={safeValue} onChange={e => onChange(e.target.value)} className="text-sm" rows={3} />
      ) : (
        <Input value={safeValue} onChange={e => onChange(e.target.value)} className="text-sm h-9" />
      )}
    </div>
  );
}

/**
 * Renderiza tabela padronizada para ônus retornados pela IA como array
 * (alienação fiduciária, penhora, hipoteca). Apresenta cada item de forma
 * legível em vez de despejar JSON cru no Textarea.
 */
function EncumbranceTable({ label, items, statusKey }: {
  label: string;
  items: any[];
  statusKey: 'status_hipoteca' | 'status_fiduciaria' | 'status_penhora';
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label className="text-xs">{label}</Label>
        <span title="Preenchido pela IA"><Bot className="w-3 h-3 text-primary" /></span>
        <span className="text-[10px] text-muted-foreground">({items.length})</span>
      </div>
      <div className="border border-border rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-2 font-medium w-32">Ato origem</th>
              <th className="text-left p-2 font-medium w-24">Status</th>
              <th className="text-left p-2 font-medium w-32">Cancelamento</th>
              <th className="text-left p-2 font-medium">Descrição</th>
            </tr>
          </thead>
          <tbody>
            {items.map((m: any, idx: number) => {
              const status = m?.[statusKey] ?? m?.status_hipoteca ?? m?.status_fiduciaria ?? m?.status_penhora ?? 'indefinida';
              return (
                <tr key={idx} className="border-t border-border align-top">
                  <td className="p-2 font-mono">{m?.ato_origem ?? '—'}</td>
                  <td className="p-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${
                      status === 'ativa' ? 'bg-destructive/10 text-destructive border border-destructive/30' :
                      status === 'cancelada' ? 'bg-success/10 text-success border border-success/30' :
                      'bg-warning/10 text-warning border border-warning/30'
                    }`}>
                      {status}
                    </span>
                  </td>
                  <td className="p-2 font-mono text-muted-foreground">{m?.ato_cancelamento ?? '—'}</td>
                  <td className="p-2 leading-relaxed">{m?.descricao ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * F3 — Compõe o valor exibido no campo "Regime de casamento" embutindo
 * o período legislativo no mesmo input (sem badge separado).
 */
function composeRegimeWithLei(regime: unknown, vigencia: unknown): string {
  const base = (regime ?? '').toString().trim();
  if (!base) return '';
  switch (vigencia) {
    case 'antes_da_vigencia_6515':
      return `${base} (anterior à Lei 6.515/77 — CC/1916)`;
    case 'vigencia_6515':
    // retrocompatibilidade com valor antigo 'apos_vigencia'
    case 'apos_vigencia':
      return `${base} (na vigência da Lei 6.515/77)`;
    case 'vigencia_cc2002':
      return `${base} (na vigência do CC/2002 — Lei 10.406/2002)`;
    // retrocompatibilidade com valor antigo 'antes_da_vigencia'
    case 'antes_da_vigencia':
      return `${base} (anterior à Lei 6.515/77 — CC/1916)`;
    default:
      return base;
  }
}

export default function AnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const deleteAnalysis = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('analyses').delete().eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-analyses'] });
      toast({ title: 'Análise excluída' });
      navigate('/history');
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const { data: analysis, isLoading } = useQuery({
    queryKey: ['analysis', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('analyses')
        .select('*, property:properties(denomination, client:clients(name))')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });



  const [formData, setFormData] = useState<any>(null);

  // Initialize form when data loads
  if (analysis && !formData) {
    const ed = (analysis.extracted_data as any) ?? {};
    if (ed.owners) {
      try {
        ed.owners = deduplicateConjuges(ed.owners);
      } catch (e) {
        console.error('deduplicateConjuges error:', e);
      }
    }
    setFormData(ed);
  }

  const updateField = (path: string, value: any) => {
    setFormData((prev: any) => {
      const copy = { ...prev };
      const keys = path.split('.');
      let obj = copy;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]]) obj[keys[i]] = {};
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return copy;
    });
  };

  const getField = (path: string): string => {
    if (!formData) return '';
    const keys = path.split('.');
    let obj = formData;
    for (const k of keys) {
      if (!obj) return '';
      obj = obj[k];
    }
    return obj ?? '';
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('analyses')
        .update({ extracted_data: formData })
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analysis', id] });
      toast({ title: 'Análise salva!' });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const alerts = (analysis?.alerts as any[]) ?? [];

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Carregando...</div>;
  if (!analysis) return <div className="text-center py-12 text-muted-foreground">Análise não encontrada</div>;

  const severityIcon = (s: string) => {
    if (s === 'critical') return <AlertCircle className="w-4 h-4 text-destructive" />;
    if (s === 'warning') return <AlertTriangle className="w-4 h-4 text-warning" />;
    return <Info className="w-4 h-4 text-info" />;
  };

  const severityClass = (s: string) => {
    if (s === 'critical') return 'status-badge-critical';
    if (s === 'warning') return 'status-badge-warning';
    return 'status-badge-info';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/history"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
          <div>
            <h1 className="text-2xl font-heading font-bold">
              {(analysis as any).property?.denomination ?? 'Análise'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {(analysis as any).property?.client?.name} · Versão {analysis.version}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => {
            const d = {
              extractedData: formData,
              alerts,
              propertyName: (analysis as any).property?.denomination ?? 'Imóvel',
              clientName: (analysis as any).property?.client?.name ?? '',
              version: analysis.version,
              createdAt: analysis.created_at,
              neighbors: formData?.boundaries?.neighbors ?? [],
            };
            exportToWord(d);
          }}>
            <FileText className="w-4 h-4 mr-2" />Word
          </Button>
          <Button variant="outline" onClick={() => {
            const d = {
              extractedData: formData,
              alerts,
              propertyName: (analysis as any).property?.denomination ?? 'Imóvel',
              clientName: (analysis as any).property?.client?.name ?? '',
              version: analysis.version,
              createdAt: analysis.created_at,
              neighbors: formData?.boundaries?.neighbors ?? [],
            };
            exportToPdf(d);
          }}>
            <FileDown className="w-4 h-4 mr-2" />PDF
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="w-4 h-4 mr-2" />
            {saveMutation.isPending ? 'Salvando...' : 'Salvar Análise'}
          </Button>
          <DeleteButton
            variant="outline"
            label="Excluir"
            title="Excluir análise?"
            description="A análise da matrícula será removida permanentemente."
            onConfirm={async () => { await deleteAnalysis.mutateAsync(); }}
            stopPropagation={false}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main form */}
        <div className="lg:col-span-3">
          <Tabs defaultValue="identification">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="identification">Identificação</TabsTrigger>
              <TabsTrigger value="owners">Proprietários</TabsTrigger>
              <TabsTrigger value="encumbrances">Ônus</TabsTrigger>
              <TabsTrigger value="boundaries">Confrontantes</TabsTrigger>
              <TabsTrigger value="transfers">Transmissões</TabsTrigger>
            </TabsList>

            <TabsContent value="identification">
              <Card>
                <CardContent className="p-5 grid grid-cols-2 gap-4">
                  <FieldWithAiIndicator label="Denominação do imóvel" value={getField('identification.denomination')} onChange={v => updateField('identification.denomination', v)} required />
                  <FieldWithAiIndicator label="Nº da matrícula" value={getField('identification.registration_number')} onChange={v => updateField('identification.registration_number', v)} required />
                  <FieldWithAiIndicator label="CCIR atual" value={getField('identification.ccir')} onChange={v => updateField('identification.ccir', v)} />
                  <FieldWithAiIndicator label="Área total (ha)" value={getField('identification.total_area')} onChange={v => updateField('identification.total_area', v)} required />
                  <FieldWithAiIndicator label="Município" value={getField('identification.municipality')} onChange={v => updateField('identification.municipality', v)} required />
                  <FieldWithAiIndicator label="UF" value={getField('identification.state')} onChange={v => updateField('identification.state', v)} required />
                  <FieldWithAiIndicator label="Comarca" value={getField('identification.county')} onChange={v => updateField('identification.county', v)} />
                  <FieldWithAiIndicator label="Cartório" value={getField('identification.registry_office')} onChange={v => updateField('identification.registry_office', v)} />
                  <FieldWithAiIndicator label="Fração ideal" value={getField('identification.ideal_fraction')} onChange={v => updateField('identification.ideal_fraction', v)} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="owners">
              <Card>
                <CardHeader><CardTitle className="text-base">Proprietários</CardTitle></CardHeader>
                <CardContent className="space-y-6">
                  {(formData?.owners ?? [{}]).map((owner: any, i: number) => {
                    const updateOwner = (patch: any) => {
                      const owners = [...(formData?.owners ?? [{}])];
                      owners[i] = { ...owners[i], ...patch };
                      updateField('owners', owners);
                    };
                    const updateSpouse = (patch: any) => {
                      const owners = [...(formData?.owners ?? [{}])];
                      owners[i] = { ...owners[i], spouse: { ...(owners[i]?.spouse ?? {}), ...patch } };
                      updateField('owners', owners);
                    };
                    const isMarried = (owner?.marital_status ?? '').toString().toLowerCase().startsWith('cas');
                    const showSpouseSection = isMarried && !!(owner?.spouse?.name || owner?.spouse?.cpf || owner?.spouse?.rg);
                    const spouseIsCoOwner = !!(owner?.spouse?.share_percentage);
                    const fonte = owner?.fonte_dados_documentais;
                    const verifTit = owner?.verificar_titularidade;
                    return (
                      <div key={i} className="p-4 border border-border rounded-lg space-y-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-primary">Proprietário {i + 1}</p>
                          {getRoleBadge(owner)}
                          {fonte === 'averbacao_anterior' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-info/10 text-info border border-info/30">
                              dados de averbação anterior
                            </span>
                          )}
                          {fonte === 'nao_encontrado' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/30">
                              CPF/RG não encontrado
                            </span>
                          )}
                          {verifTit && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/30">
                              ⚠ verificar titularidade
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <FieldWithAiIndicator label="Nome completo" value={owner?.name} onChange={v => updateOwner({ name: v })} required />
                          <FieldWithAiIndicator label="CPF/CNPJ" value={owner?.cpf_cnpj} onChange={v => updateOwner({ cpf_cnpj: v })} required />
                          <FieldWithAiIndicator label="RG" value={owner?.rg} onChange={v => updateOwner({ rg: v })} />
                          <FieldWithAiIndicator label="Data de nascimento" value={owner?.birth_date} onChange={v => updateOwner({ birth_date: v })} />
                          <FieldWithAiIndicator label="Nacionalidade" value={owner?.nationality} onChange={v => updateOwner({ nationality: v })} />
                          <FieldWithAiIndicator label="Estado civil" value={owner?.marital_status} onChange={v => updateOwner({ marital_status: v })} />
                          {/* F3 — Regime composto com referência à Lei 6.515/77 no mesmo input */}
                          <FieldWithAiIndicator
                            label="Regime de casamento"
                            value={composeRegimeWithLei(owner?.marriage_regime, owner?.vigencia_lei_divorcio)}
                            onChange={v => updateOwner({ marriage_regime: v, vigencia_lei_divorcio: undefined })}
                          />
                          <FieldWithAiIndicator label="Participação (%)" value={owner?.share_percentage} onChange={v => updateOwner({ share_percentage: v })} />
                          
                          {/* Campos extras para Usufruto / Nu-Propriedade */}
                          {owner.role === 'nu_proprietario_e_proprietario_pleno' && (
                            <>
                              <FieldWithAiIndicator label="Nua-propriedade" value={owner?.share_nu_propriedade} onChange={v => updateOwner({ share_nu_propriedade: v })} />
                              <FieldWithAiIndicator label="Propriedade plena" value={owner?.share_propriedade_plena} onChange={v => updateOwner({ share_propriedade_plena: v })} />
                            </>
                          )}
                          {owner.role === 'usufrutuario' && (
                            <>
                              <FieldWithAiIndicator 
                                label="Usufruto" 
                                value={`${owner?.share_usufruto ?? ''}${owner?.usufruto_tipo === 'vitalicio' ? ' (vitalício)' : ''}`} 
                                onChange={v => updateOwner({ share_usufruto: v })} 
                              />
                              <FieldWithAiIndicator label="Ato" value={owner?.usufruto_ato} onChange={v => updateOwner({ usufruto_ato: v })} />
                            </>
                          )}
                          <div className="col-span-2">
                            <FieldWithAiIndicator label="Endereço" value={owner?.address} onChange={v => updateOwner({ address: v })} multiline />
                          </div>
                        </div>
                        {showSpouseSection && (
                          <div className="pl-3 border-l-2 border-primary/20 space-y-3">
                            <p className="text-xs font-semibold text-muted-foreground">
                              {spouseIsCoOwner ? 'Cônjuge (co-proprietário)' : 'Cônjuge'}
                            </p>
                            <div className="grid grid-cols-2 gap-3">
                              <FieldWithAiIndicator label="Nome do cônjuge" value={owner?.spouse?.name} onChange={v => updateSpouse({ name: v })} />
                              <FieldWithAiIndicator label="CPF do cônjuge" value={owner?.spouse?.cpf} onChange={v => updateSpouse({ cpf: v })} />
                              <FieldWithAiIndicator label="RG do cônjuge" value={owner?.spouse?.rg} onChange={v => updateSpouse({ rg: v })} />
                              {spouseIsCoOwner && (
                                <FieldWithAiIndicator
                                  label="Participação do cônjuge (%)"
                                  value={owner?.spouse?.share_percentage}
                                  onChange={v => updateSpouse({ share_percentage: v })}
                                />
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <Button variant="outline" size="sm" onClick={() => {
                    const owners = [...(formData?.owners ?? [])];
                    owners.push({});
                    updateField('owners', owners);
                  }}>Adicionar Proprietário</Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="encumbrances">
              <Card>
                <CardContent className="p-5 space-y-4">
                  {/* Alienação Fiduciária — M5/R8 também pode vir como array com status_fiduciaria */}
                  {Array.isArray(formData?.encumbrances?.fiduciary_alienation) ? (
                    <EncumbranceTable
                      label="Alienação Fiduciária"
                      items={formData.encumbrances.fiduciary_alienation}
                      statusKey="status_fiduciaria"
                    />
                  ) : (
                    <FieldWithAiIndicator label="Alienação Fiduciária" value={getField('encumbrances.fiduciary_alienation')} onChange={v => updateField('encumbrances.fiduciary_alienation', v)} multiline />
                  )}

                  {/* Penhora — idem */}
                  {Array.isArray(formData?.encumbrances?.seizure) ? (
                    <EncumbranceTable
                      label="Penhora"
                      items={formData.encumbrances.seizure}
                      statusKey="status_penhora"
                    />
                  ) : (
                    <FieldWithAiIndicator label="Penhora" value={getField('encumbrances.seizure')} onChange={v => updateField('encumbrances.seizure', v)} multiline />
                  )}

                  {/* Hipotecas: M5/R8 retorna array com status. Renderiza tabela quando aplicável. */}
                  {Array.isArray(formData?.encumbrances?.mortgage) ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs">Hipotecas</Label>
                        <span title="Preenchido pela IA"><Bot className="w-3 h-3 text-primary" /></span>
                        <span className="text-[10px] text-muted-foreground">({formData.encumbrances.mortgage.length})</span>
                      </div>
                      <div className="border border-border rounded-md overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="text-left p-2 font-medium">Ato origem</th>
                              <th className="text-left p-2 font-medium">Status</th>
                              <th className="text-left p-2 font-medium">Ato cancelamento</th>
                              <th className="text-left p-2 font-medium">Descrição</th>
                            </tr>
                          </thead>
                          <tbody>
                            {formData.encumbrances.mortgage.map((m: any, idx: number) => (
                              <tr key={idx} className="border-t border-border">
                                <td className="p-2 font-mono">{m?.ato_origem ?? '—'}</td>
                                <td className="p-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    m?.status_hipoteca === 'ativa' ? 'bg-destructive/10 text-destructive border border-destructive/30' :
                                    m?.status_hipoteca === 'cancelada' ? 'bg-success/10 text-success border border-success/30' :
                                    'bg-warning/10 text-warning border border-warning/30'
                                  }`}>
                                    {m?.status_hipoteca ?? 'indefinida'}
                                  </span>
                                </td>
                                <td className="p-2 font-mono text-muted-foreground">{m?.ato_cancelamento ?? '—'}</td>
                                <td className="p-2">{m?.descricao ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <FieldWithAiIndicator label="Hipoteca" value={getField('encumbrances.mortgage')} onChange={v => updateField('encumbrances.mortgage', v)} multiline />
                  )}

                  <FieldWithAiIndicator label="Servidões" value={getField('encumbrances.easements')} onChange={v => updateField('encumbrances.easements', v)} multiline />
                  <FieldWithAiIndicator label="Reserva Legal Averbada (ARL)" value={getField('encumbrances.legal_reserve')} onChange={v => updateField('encumbrances.legal_reserve', v)} multiline />
                  <FieldWithAiIndicator label="APP (Área de Preservação Permanente)" value={getField('encumbrances.app')} onChange={v => updateField('encumbrances.app', v)} multiline />
                  <FieldWithAiIndicator label="Outras cláusulas especiais" value={getField('encumbrances.special_clauses')} onChange={v => updateField('encumbrances.special_clauses', v)} multiline />
                  <FieldWithAiIndicator label="Observações gerais" value={getField('encumbrances.general_notes')} onChange={v => updateField('encumbrances.general_notes', v)} multiline />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="boundaries">
              <BoundariesTab formData={formData} updateField={updateField} getField={getField} />
            </TabsContent>

            <TabsContent value="transfers">
              <Card>
                <CardHeader><CardTitle className="text-base">Últimas Transmissões</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {(formData?.transfers ?? [{}]).map((_: any, i: number) => (
                    <div key={i} className="p-4 border border-border rounded-lg space-y-3">
                      <p className="text-sm font-semibold text-primary">Transmissão {i + 1}</p>
                      <div className="grid grid-cols-2 gap-3">
                        <FieldWithAiIndicator label="Data" value={getField(`transfers.${i}.date`)} onChange={v => {
                          const transfers = [...(formData?.transfers ?? [{}])];
                          transfers[i] = { ...transfers[i], date: v };
                          updateField('transfers', transfers);
                        }} />
                        <FieldWithAiIndicator label="Natureza do ato" value={getField(`transfers.${i}.nature`)} onChange={v => {
                          const transfers = [...(formData?.transfers ?? [{}])];
                          transfers[i] = { ...transfers[i], nature: v };
                          updateField('transfers', transfers);
                        }} />
                        <FieldWithAiIndicator label="Vendedor" value={getField(`transfers.${i}.seller`)} onChange={v => {
                          const transfers = [...(formData?.transfers ?? [{}])];
                          transfers[i] = { ...transfers[i], seller: v };
                          updateField('transfers', transfers);
                        }} />
                        <FieldWithAiIndicator label="Comprador" value={getField(`transfers.${i}.buyer`)} onChange={v => {
                          const transfers = [...(formData?.transfers ?? [{}])];
                          transfers[i] = { ...transfers[i], buyer: v };
                          updateField('transfers', transfers);
                        }} />
                        <FieldWithAiIndicator label="Valor" value={getField(`transfers.${i}.value`)} onChange={v => {
                          const transfers = [...(formData?.transfers ?? [{}])];
                          transfers[i] = { ...transfers[i], value: v };
                          updateField('transfers', transfers);
                        }} />
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => {
                    const transfers = [...(formData?.transfers ?? [])];
                    transfers.push({});
                    updateField('transfers', transfers);
                  }}>Adicionar Transmissão</Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Alerts sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Alertas ({alerts.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {alerts.length > 0 ? alerts.map((alert: any, i: number) => (
                <div key={i} className={`p-3 rounded-lg text-xs ${severityClass(alert.severity)}`}>
                  <div className="flex items-start gap-2">
                    {severityIcon(alert.severity)}
                    <p>{alert.message}</p>
                  </div>
                </div>
              )) : (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhum alerta</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
