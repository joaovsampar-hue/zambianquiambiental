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
import { ArrowLeft, Save, AlertTriangle, AlertCircle, Info, Bot, FileText, FileDown, Plus, Trash2, Upload, Loader2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { exportToWord, exportToPdf } from '@/lib/exportAnalysis';
import BoundariesTab from '@/components/analysis/BoundariesTab';
import DeleteButton from '@/components/DeleteButton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import * as pdfjsLib from 'pdfjs-dist';
import { Progress } from '@/components/ui/progress';

// Use a CDN worker matching the installed pdfjs-dist version
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

async function rasterizePdfToJpegs(file: File, scale = 1.5, quality = 0.85): Promise<Blob[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const blobs: Blob[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality),
    );
    blobs.push(blob);
    page.cleanup();
  }
  return blobs;
}

const getRoleBadge = (owner: any) => {
  switch (owner.role) {
    case 'nu_proprietario':
      return <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-300">Nu-Proprietário</span>;
    case 'usufrutuario':
      return <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">Usufrutuário</span>;
    case 'nu_proprietario_e_proprietario_pleno':
      return (
        <span className="ml-2 flex gap-1 inline-flex">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-800 border border-blue-300">Nu-Propriedade {owner.share_nu_propriedade}</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-800 border border-green-300">Propriedade Plena {owner.share_propriedade_plena}</span>
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

      if (!a.spouse) a.spouse = {};
      if (!a.spouse.name && b.name) a.spouse.name = b.name;
      if (!a.spouse.cpf && b.cpf_cnpj) a.spouse.cpf = b.cpf_cnpj;
      if (!a.spouse.rg && b.rg) a.spouse.rg = b.rg;
      if (b.share_percentage) a.spouse.share_percentage = b.share_percentage;
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

function composeRegimeWithLei(regime: unknown, vigencia: unknown): string {
  const base = (regime ?? '').toString().trim();
  if (!base) return '';
  switch (vigencia) {
    case 'antes_da_vigencia_6515':
      return `${base} (anterior à Lei 6.515/77 — CC/1916)`;
    case 'vigencia_6515':
    case 'apos_vigencia':
      return `${base} (na vigência da Lei 6.515/77)`;
    case 'vigencia_cc2002':
      return `${base} (na vigência do CC/2002 — Lei 10.406/2002)`;
    case 'antes_da_vigencia':
      return `${base} (anterior à Lei 6.515/77 — CC/1916)`;
    default:
      return base;
  }
}

function IdentificationTable({ data, updateField, path }: { data: any, updateField?: (p: string, v: any) => void, path?: string }) {
  const getF = (f: string) => data?.[f] || '';
  const upF = (f: string, v: string) => updateField?.(`${path}.${f}`, v);

  return (
    <div className="grid grid-cols-2 gap-3">
      <FieldWithAiIndicator label="Denominação" value={getF('denomination')} onChange={v => upF('denomination', v)} />
      <FieldWithAiIndicator label="Nº Matrícula" value={getF('registration_number')} onChange={v => upF('registration_number', v)} />
      <FieldWithAiIndicator label="CCIR" value={getF('ccir')} onChange={v => upF('ccir', v)} />
      <FieldWithAiIndicator label="Área Total (ha)" value={getF('total_area')} onChange={v => upF('total_area', v)} />
      <FieldWithAiIndicator label="Município" value={getF('municipality')} onChange={v => upF('municipality', v)} />
      <FieldWithAiIndicator label="UF" value={getF('state')} onChange={v => upF('state', v)} />
      <FieldWithAiIndicator label="Comarca" value={getF('county')} onChange={v => upF('county', v)} />
      <FieldWithAiIndicator label="Cartório" value={getF('registry_office')} onChange={v => upF('registry_office', v)} />
      <FieldWithAiIndicator label="Fração Ideal" value={getF('ideal_fraction')} onChange={v => upF('ideal_fraction', v)} />
    </div>
  );
}

function TransmissionsTable({ transfers, updateField, path }: { transfers: any[], updateField?: (p: string, v: any) => void, path?: string }) {
  const safeTransfers = transfers ?? [];
  return (
    <div className="space-y-4">
      {(safeTransfers.length > 0 ? safeTransfers : [{}]).map((_: any, i: number) => (
        <div key={i} className="p-4 border border-border rounded-lg space-y-3">
          <p className="text-sm font-semibold text-primary">Transmissão {i + 1}</p>
          <div className="grid grid-cols-2 gap-3">
            <FieldWithAiIndicator label="Data" value={safeTransfers[i]?.date} onChange={v => {
              const newT = [...safeTransfers];
              newT[i] = { ...newT[i], date: v };
              updateField?.(path!, newT);
            }} />
            <FieldWithAiIndicator label="Natureza do ato" value={safeTransfers[i]?.nature} onChange={v => {
              const newT = [...safeTransfers];
              newT[i] = { ...newT[i], nature: v };
              updateField?.(path!, newT);
            }} />
            <FieldWithAiIndicator label="Vendedor" value={safeTransfers[i]?.seller} onChange={v => {
              const newT = [...safeTransfers];
              newT[i] = { ...newT[i], seller: v };
              updateField?.(path!, newT);
            }} />
            <FieldWithAiIndicator label="Comprador" value={safeTransfers[i]?.buyer} onChange={v => {
              const newT = [...safeTransfers];
              newT[i] = { ...newT[i], buyer: v };
              updateField?.(path!, newT);
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const consolidateOwners = (matriculasData: any[]) => {
  const ownerMap = new Map<string, any>();
  matriculasData.forEach((m, matIdx) => {
    (m.extracted_data.owners ?? []).forEach((owner: any) => {
      const key = owner.cpf_cnpj || owner.name;
      if (!ownerMap.has(key)) {
        ownerMap.set(key, { ...owner, matriculas: [matIdx + 1] });
      } else {
        const existing = ownerMap.get(key);
        if (!existing.matriculas.includes(matIdx + 1)) { existing.matriculas.push(matIdx + 1); }
        if (existing.role !== owner.role) { existing.role_divergence = true; }
      }
    });
  });
  return Array.from(ownerMap.values());
};

const consolidateEncumbrances = (matriculasData: any[]) => {
  const all: any[] = [];
  matriculasData.forEach((m, matIdx) => {
    const enc = m.extracted_data.encumbrances ?? {};
    const regNum = m.extracted_data.identification?.registration_number || `Mat. ${matIdx + 1}`;
    if (Array.isArray(enc.mortgage)) {
      enc.mortgage.filter((h: any) => h.status_hipoteca !== 'cancelada').forEach((h: any) => all.push({ ...h, _matricula: regNum, _tipo: 'Hipoteca' }));
    }
    if (Array.isArray(enc.fiduciary_alienation)) {
      enc.fiduciary_alienation.filter((f: any) => f.status_fiduciaria !== 'cancelada').forEach((f: any) => all.push({ ...f, _matricula: regNum, _tipo: 'Alienação Fiduciária' }));
    }
    if (Array.isArray(enc.seizure)) {
      enc.seizure.filter((p: any) => p.status_penhora !== 'cancelada').forEach((p: any) => all.push({ ...p, _matricula: regNum, _tipo: 'Penhora' }));
    }
  });
  return all;
};

const consolidateAlerts = (matriculasData: any[], rawAlerts: any[]) => {
  const all: any[] = [];
  matriculasData.forEach((m, matIdx) => {
    const regNum = m.extracted_data.identification?.registration_number || `Mat. ${matIdx + 1}`;
    (m.alerts ?? []).forEach((a: any) => { all.push({ ...a, message: `[Mat. ${regNum}] ${a.message}` }); });
  });
  const owners = consolidateOwners(matriculasData);
  owners.filter((o: any) => o.role_divergence).forEach((o: any) => {
    all.push({ severity: 'warning', message: `[DIVERGÊNCIA] O proprietário ${o.name} tem roles diferentes entre as matrículas.` });
  });
  const ccirs = matriculasData.map(m => m.extracted_data.identification?.ccir).filter(Boolean);
  const uniqueCcirs = new Set(ccirs);
  if (uniqueCcirs.size > 1) {
    all.push({ severity: 'warning', message: `[CCIR DIVERGENTE] As matrículas possuem CCIRs diferentes: ${[...uniqueCcirs].join(', ')}.` });
  }
  return all.length > 0 ? all : rawAlerts;
};

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
      const { data, error } = await supabase.from('analyses').select('*, property:properties(denomination, client:clients(name))').eq('id', id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [formData, setFormData] = useState<any>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [isProcessingNew, setIsProcessingNew] = useState(false);
  const [newProgress, setNewProgress] = useState(0);
  const [newStep, setNewStep] = useState('');

  if (analysis && !formData) {
    const ed = JSON.parse(JSON.stringify((analysis.extracted_data as any) ?? {}));
    if (ed.owners) { try { ed.owners = deduplicateConjuges(ed.owners); } catch (e) {} }
    if (ed.matriculas_data) {
      ed.matriculas_data.forEach((m: any) => {
        if (m.extracted_data?.owners) { try { m.extracted_data.owners = deduplicateConjuges(m.extracted_data.owners); } catch (e) {} }
      });
    }
    setFormData(ed);
  }

  const handleAddMatricula = async () => {
    if (!newFile || !id) return;
    setIsProcessingNew(true);
    setNewProgress(0);
    setNewStep('Preparando upload...');
    try {
      const ts = Date.now();
      const filePath = `${analysis.created_by}/${ts}_${newFile.name}`;
      const { error: uploadError } = await supabase.storage.from('matriculas').upload(filePath, newFile);
      if (uploadError) throw uploadError;
      setNewProgress(20);
      setNewStep('Convertendo páginas em imagens...');
      const pageBlobs = await rasterizePdfToJpegs(newFile);
      const pagesPrefix = `${analysis.created_by}/${ts}_pages`;
      const imagePaths: string[] = [];
      for (let i = 0; i < pageBlobs.length; i++) {
        const path = `${pagesPrefix}/page-${String(i + 1).padStart(3, '0')}.jpg`;
        const { error: pErr } = await supabase.storage.from('matriculas').upload(path, pageBlobs[i], { contentType: 'image/jpeg' });
        if (pErr) throw pErr;
        imagePaths.push(path);
      }
      setNewProgress(50);
      setNewStep('Analisando com IA...');
      const { data: funcData, error: funcError } = await supabase.functions.invoke('process-matricula', { body: { analysisId: id, pdfPath: filePath, imagePaths } });
      if (funcError) throw funcError;
      setNewProgress(90);
      const extracted = funcData.extracted_data;
      if (extracted?.owners) { extracted.owners = deduplicateConjuges(extracted.owners); }
      const newEntry = { pdf_name: newFile.name, extracted_data: extracted || {}, alerts: funcData.alerts || [], status: 'completed' as const };
      const updatedMatriculasData = [...(formData.matriculas_data || [])];
      if (updatedMatriculasData.length === 0 && formData.identification) {
        updatedMatriculasData.push({ pdf_name: analysis.pdf_path?.split('/').pop() || 'Matrícula Original', extracted_data: JSON.parse(JSON.stringify(formData)), alerts: analysis.alerts || [], status: 'completed' as const });
      }
      updatedMatriculasData.push(newEntry);
      setFormData((prev: any) => ({ ...prev, matriculas_data: updatedMatriculasData }));
      setIsAddModalOpen(false);
      setNewFile(null);
      toast({ title: 'Nova matrícula adicionada!' });
    } catch (e: any) {
      toast({ title: 'Erro ao adicionar matrícula', description: e.message, variant: 'destructive' });
    } finally {
      setIsProcessingNew(false);
      setNewStep('');
      setNewProgress(0);
    }
  };

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
    for (const k of keys) { if (!obj) return ''; obj = obj[k]; }
    return obj ?? '';
  };

  const saveMutation = useMutation({
    mutationFn: async () => { await supabase.from('analyses').update({ extracted_data: formData }).eq('id', id!); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['analysis', id] }); toast({ title: 'Análise salva!' }); },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const alerts = (analysis?.alerts as any[]) ?? [];
  const matriculasData = formData?.matriculas_data ?? [];
  const owners = matriculasData.length > 0 ? consolidateOwners(matriculasData) : (formData?.owners ?? []);
  const encumbrances = matriculasData.length > 0 ? consolidateEncumbrances(matriculasData) : [];
  const displayAlerts = consolidateAlerts(matriculasData, alerts);

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Carregando...</div>;
  if (!analysis) return <div className="text-center py-12 text-muted-foreground">Análise não encontrada</div>;

  const severityIcon = (s: string) => {
    if (s === 'critical') return <AlertCircle className="w-4 h-4 text-destructive" />;
    if (s === 'warning') return <AlertTriangle className="w-4 h-4 text-warning" />;
    return <Info className="w-4 h-4 text-info" />;
  };

  const severityClass = (s: string) => {
    if (s === 'critical') return 'bg-destructive/10 border-destructive/20';
    if (s === 'warning') return 'bg-warning/10 border-warning/20';
    return 'bg-info/10 border-info/20';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/history"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
          <div>
            <h1 className="text-2xl font-heading font-bold">{(analysis as any).property?.denomination ?? 'Análise'}</h1>
            <p className="text-muted-foreground text-sm">{(analysis as any).property?.client?.name} · Versão {analysis.version}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => exportToWord({ extractedData: formData, alerts: displayAlerts, propertyName: (analysis as any).property?.denomination ?? 'Imóvel', clientName: (analysis as any).property?.client?.name ?? '', version: analysis.version, createdAt: analysis.created_at, neighbors: formData?.boundaries?.neighbors ?? [] })}><FileText className="w-4 h-4 mr-2" />Word</Button>
          <Button variant="outline" onClick={() => exportToPdf({ extractedData: formData, alerts: displayAlerts, propertyName: (analysis as any).property?.denomination ?? 'Imóvel', clientName: (analysis as any).property?.client?.name ?? '', version: analysis.version, createdAt: analysis.created_at, neighbors: formData?.boundaries?.neighbors ?? [] })}><FileDown className="w-4 h-4 mr-2" />PDF</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}><Save className="w-4 h-4 mr-2" />{saveMutation.isPending ? 'Salvando...' : 'Salvar Análise'}</Button>
          <DeleteButton variant="outline" label="Excluir" title="Excluir análise?" description="A análise da matrícula será removida permanentemente." onConfirm={async () => { await deleteAnalysis.mutateAsync(); }} stopPropagation={false} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
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
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold">Documentos Analisados</h3>
                    <Button variant="outline" size="sm" onClick={() => setIsAddModalOpen(true)}><Plus className="w-4 h-4 mr-2" />Adicionar matrícula</Button>
                  </div>
                  {formData?.matriculas_data ? (
                    <div className="space-y-8">
                      {formData.matriculas_data.map((m: any, idx: number) => (
                        <div key={idx} className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">Matrícula {idx + 1} — {m.extracted_data?.identification?.registration_number || '—'}</span>
                              <span className="text-xs text-muted-foreground">{m.pdf_name}</span>
                            </div>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => { const newM = [...formData.matriculas_data]; newM.splice(idx, 1); updateField('matriculas_data', newM); }}><Trash2 className="w-4 h-4" /></Button>
                          </div>
                          <IdentificationTable data={m.extracted_data?.identification} updateField={updateField} path={`matriculas_data.${idx}.extracted_data.identification`} />
                        </div>
                      ))}
                    </div>
                  ) : <IdentificationTable data={formData?.identification} updateField={updateField} path="identification" />}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="owners">
              <Card>
                <CardHeader><CardTitle className="text-base">Proprietários Consolidados</CardTitle></CardHeader>
                <CardContent className="space-y-6">
                  {owners.map((owner: any, i: number) => {
                    const updateOwner = (patch: any) => {
                      const updateFn = (o: any) => { if ((o.cpf_cnpj || o.name) === (owner.cpf_cnpj || owner.name)) return { ...o, ...patch }; return o; };
                      if (matriculasData.length === 0) { const newOwners = (formData.owners || []).map(updateFn); updateField('owners', newOwners); }
                      else { const updatedMatData = matriculasData.map((m: any) => ({ ...m, extracted_data: { ...m.extracted_data, owners: (m.extracted_data.owners || []).map(updateFn) } })); updateField('matriculas_data', updatedMatData); }
                    };
                    const updateSpouse = (patch: any) => {
                      const updateFn = (o: any) => { if ((o.cpf_cnpj || o.name) === (owner.cpf_cnpj || owner.name)) return { ...o, spouse: { ...(o.spouse ?? {}), ...patch } }; return o; };
                      if (matriculasData.length === 0) { const newOwners = (formData.owners || []).map(updateFn); updateField('owners', newOwners); }
                      else { const updatedMatData = matriculasData.map((m: any) => ({ ...m, extracted_data: { ...m.extracted_data, owners: (m.extracted_data.owners || []).map(updateFn) } })); updateField('matriculas_data', updatedMatData); }
                    };
                    const isMarried = (owner?.marital_status ?? '').toString().toLowerCase().startsWith('cas');
                    const showSpouseSection = isMarried && !!(owner?.spouse?.name || owner?.spouse?.cpf || owner?.spouse?.rg);
                    const spouseIsCoOwner = !!(owner?.spouse?.share_percentage);
                    const fonte = owner?.fonte_dados_documentais;
                    const verifTit = owner?.verificar_titularidade;

                    const getOwnerLabel = (owner: any, index: number): string => {
                      switch (owner.role) {
                        case 'usufrutuario': return `Usufrutuário ${index + 1}`;
                        case 'nu_proprietario': return `Proprietário ${index + 1} — Nu-Proprietário`;
                        case 'nu_proprietario_e_proprietario_pleno': return `Proprietário ${index + 1}`;
                        default: return `Proprietário ${index + 1}`;
                      }
                    };

                    return (
                      <div key={i} className="p-4 border border-border rounded-lg space-y-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-primary">{getOwnerLabel(owner, i)}</p>
                          {getRoleBadge(owner)}
                          {owner.matriculas && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">{owner.matriculas.length === matriculasData.length ? 'Presente em todas as matrículas' : `Mat. ${owner.matriculas.join(', ')}`}</span>}
                          {owner.role_divergence && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-warning/10 text-warning border border-warning/30 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Divergência de papel entre matrículas</span>}
                          {fonte === 'averbacao_anterior' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-info/10 text-info border border-info/30">dados de averbação anterior</span>}
                          {fonte === 'nao_encontrado' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/30">CPF/RG não encontrado</span>}
                          {verifTit && <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/30">⚠ verificar titularidade</span>}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <FieldWithAiIndicator label="Nome completo" value={owner?.name} onChange={v => updateOwner({ name: v })} required />
                          <FieldWithAiIndicator label="CPF/CNPJ" value={owner?.cpf_cnpj} onChange={v => updateOwner({ cpf_cnpj: v })} required />
                          <FieldWithAiIndicator label="RG" value={owner?.rg} onChange={v => updateOwner({ rg: v })} />
                          <FieldWithAiIndicator label="Data de nascimento" value={owner?.birth_date} onChange={v => updateOwner({ birth_date: v })} />
                          <FieldWithAiIndicator label="Nacionalidade" value={owner?.nationality} onChange={v => updateOwner({ nationality: v })} />
                          <FieldWithAiIndicator label="Estado civil" value={owner?.marital_status} onChange={v => updateOwner({ marital_status: v })} />
                          <FieldWithAiIndicator label="Regime de casamento" value={composeRegimeWithLei(owner?.marriage_regime, owner?.vigencia_lei_divorcio)} onChange={v => updateOwner({ marriage_regime: v, vigencia_lei_divorcio: undefined })} />
                          <FieldWithAiIndicator label="Participação (%)" value={owner?.share_percentage} onChange={v => updateOwner({ share_percentage: v })} />
                          {owner.role === 'nu_proprietario_e_proprietario_pleno' && (
                            <>
                              <FieldWithAiIndicator label="Nua-propriedade (%)" value={owner?.share_nu_propriedade} onChange={v => updateOwner({ share_nu_propriedade: v })} />
                              <FieldWithAiIndicator label="Propriedade plena (%)" value={owner?.share_propriedade_plena} onChange={v => updateOwner({ share_propriedade_plena: v })} />
                            </>
                          )}
                          {owner.role === 'usufrutuario' && (
                            <>
                              <FieldWithAiIndicator label="Usufruto (%)" value={owner?.share_usufruto || owner?.share_percentage} onChange={v => updateOwner({ share_usufruto: v })} />
                              <FieldWithAiIndicator label="Tipo de usufruto" value={owner?.usufruto_tipo === 'vitalicio' ? 'Vitalício' : (owner?.usufruto_tipo || '—')} onChange={v => updateOwner({ usufruto_tipo: v })} />
                              <FieldWithAiIndicator label="Ato constitutivo" value={owner?.usufruto_ato} onChange={v => updateOwner({ usufruto_ato: v })} />
                            </>
                          )}
                          <div className="col-span-2"><FieldWithAiIndicator label="Endereço" value={owner?.address} onChange={v => updateOwner({ address: v })} multiline /></div>
                        </div>
                        {showSpouseSection && (
                          <div className="pl-3 border-l-2 border-primary/20 space-y-3">
                            <p className="text-xs font-semibold text-muted-foreground">{spouseIsCoOwner ? 'Cônjuge (co-proprietário)' : 'Cônjuge'}</p>
                            <div className="grid grid-cols-2 gap-3">
                              <FieldWithAiIndicator label="Nome do cônjuge" value={owner?.spouse?.name} onChange={v => updateSpouse({ name: v })} />
                              <FieldWithAiIndicator label="CPF do cônjuge" value={owner?.spouse?.cpf} onChange={v => updateSpouse({ cpf: v })} />
                              <FieldWithAiIndicator label="RG do cônjuge" value={owner?.spouse?.rg} onChange={v => updateSpouse({ rg: v })} />
                              {spouseIsCoOwner && <FieldWithAiIndicator label="Participação do cônjuge (%)" value={owner?.spouse?.share_percentage} onChange={v => updateSpouse({ share_percentage: v })} />}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <Button variant="outline" size="sm" onClick={() => { const o = [...(formData?.owners ?? [])]; o.push({}); updateField('owners', o); }}>Adicionar Proprietário</Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="encumbrances">
              <Card>
                <CardHeader><CardTitle className="text-base">Ônus e Restrições Ativos</CardTitle></CardHeader>
                <CardContent className="space-y-6">
                  {matriculasData.length > 0 ? (
                    <div className="border border-border rounded-md overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left p-2 font-medium w-24">Matrícula</th>
                            <th className="text-left p-2 font-medium w-32">Tipo</th>
                            <th className="text-left p-2 font-medium w-32">Ato origem</th>
                            <th className="text-left p-2 font-medium w-24">Status</th>
                            <th className="text-left p-2 font-medium">Descrição</th>
                          </tr>
                        </thead>
                        <tbody>
                          {encumbrances.map((e, idx) => (
                            <tr key={idx} className="border-t border-border align-top">
                              <td className="p-2 font-mono whitespace-nowrap">{e._matricula}</td>
                              <td className="p-2 font-medium">{e._tipo}</td>
                              <td className="p-2 font-mono">{e.ato_origem || '—'}</td>
                              <td className="p-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-destructive/10 text-destructive border border-destructive/30">ativa</span></td>
                              <td className="p-2 leading-relaxed">{e.descricao || '—'}</td>
                            </tr>
                          ))}
                          {encumbrances.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">Nenhum ônus ativo identificado em nenhuma matrícula</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <>
                      <EncumbranceTable label="Alienação Fiduciária" items={formData?.encumbrances?.fiduciary_alienation ?? []} statusKey="status_fiduciaria" />
                      <EncumbranceTable label="Penhora" items={formData?.encumbrances?.seizure ?? []} statusKey="status_penhora" />
                      <EncumbranceTable label="Hipoteca" items={formData?.encumbrances?.mortgage ?? []} statusKey="status_hipoteca" />
                    </>
                  )}
                  <div className="pt-4 border-t border-border grid grid-cols-2 gap-4">
                    <FieldWithAiIndicator label="Servidões" value={formData?.encumbrances?.easements} onChange={v => updateField('encumbrances.easements', v)} multiline />
                    <FieldWithAiIndicator label="Reserva Legal (ARL)" value={formData?.encumbrances?.legal_reserve} onChange={v => updateField('encumbrances.legal_reserve', v)} multiline />
                    <FieldWithAiIndicator label="APP" value={formData?.encumbrances?.app} onChange={v => updateField('encumbrances.app', v)} multiline />
                    <FieldWithAiIndicator label="Cláusulas Especiais" value={formData?.encumbrances?.special_clauses} onChange={v => updateField('encumbrances.special_clauses', v)} multiline />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="boundaries"><BoundariesTab formData={formData} updateField={updateField} getField={getField} /></TabsContent>

            <TabsContent value="transfers">
              <Card>
                <CardHeader><CardTitle className="text-base">Transmissões de Propriedade</CardTitle></CardHeader>
                <CardContent className="space-y-6">
                  {matriculasData.length > 0 ? (
                    <div className="space-y-10">
                      {matriculasData.map((m: any, idx: number) => (
                        <div key={idx} className="space-y-4">
                          <h3 className="text-sm font-semibold text-primary border-b pb-2 flex justify-between">
                            <span>Transmissões — Matrícula {m.extracted_data?.identification?.registration_number || idx + 1}</span>
                            <span className="text-[10px] text-muted-foreground">{m.pdf_name}</span>
                          </h3>
                          <TransmissionsTable transfers={m.extracted_data?.transfers} updateField={updateField} path={`matriculas_data.${idx}.extracted_data.transfers`} />
                        </div>
                      ))}
                    </div>
                  ) : <TransmissionsTable transfers={formData?.transfers} updateField={updateField} path="transfers" />}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-semibold flex items-center gap-2"><AlertCircle className="w-4 h-4 text-primary" /> Alertas da IA</h2>
          <div className="space-y-3">
            {displayAlerts.length > 0 ? displayAlerts.map((alert: any, i: number) => (
              <div key={i} className={`p-3 rounded-lg border flex gap-3 ${severityClass(alert.severity)}`}>
                <div className="mt-0.5">{severityIcon(alert.severity)}</div>
                <div className="text-xs leading-relaxed">{alert.message}</div>
              </div>
            )) : <div className="p-8 text-center border border-dashed rounded-lg"><p className="text-xs text-muted-foreground">Nenhum alerta crítico identificado.</p></div>}
          </div>
        </div>
      </div>

      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader><DialogTitle>Adicionar Matrícula à Análise</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div onClick={() => document.getElementById('new-pdf-input')?.click()} className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-accent/30 transition-colors">
              <input id="new-pdf-input" type="file" accept=".pdf" className="hidden" onChange={e => setNewFile(e.target.files?.[0] || null)} />
              {newFile ? (
                <div className="flex items-center justify-center gap-3">
                  <FileText className="w-8 h-8 text-primary" />
                  <div className="text-left"><p className="font-medium text-sm">{newFile.name}</p><p className="text-xs text-muted-foreground">{(newFile.size / 1024 / 1024).toFixed(2)} MB</p></div>
                </div>
              ) : (<div><Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" /><p className="text-sm font-medium">Clique para selecionar o PDF</p></div>)}
            </div>
            {isProcessingNew && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">{newStep}</span><span className="font-medium">{newProgress}%</span></div>
                <Progress value={newProgress} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddModalOpen(false)} disabled={isProcessingNew}>Cancelar</Button>
            <Button onClick={handleAddMatricula} disabled={!newFile || isProcessingNew}>{isProcessingNew ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processando...</> : 'Confirmar e Analisar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
