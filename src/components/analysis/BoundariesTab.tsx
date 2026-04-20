import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Bot, Upload, Loader2, Trash2, MapPin, FileText, User, Building, Plus } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface NeighborPdf {
  file_name: string;
  pdf_path: string;
  status: 'processing' | 'completed' | 'error';
  error_message?: string;
}

interface NeighborOwner {
  name: string;
  cpf_cnpj: string;
  rg?: string;
  marital_status?: string;
  marriage_regime?: string;
  vigencia_lei_divorcio?: 'antes_da_vigencia' | 'apos_vigencia' | 'nao_identificado';
  spouse?: { name?: string; cpf?: string; rg?: string };
  fonte_dados_documentais?: string;
  verificar_titularidade?: boolean;
}

interface NeighborMortgage {
  descricao?: string;
  ato_origem?: string | null;
  status_hipoteca?: 'ativa' | 'cancelada' | 'indefinida';
  ato_cancelamento?: string | null;
}

interface NeighborProperty {
  registration_number: string;
  denomination: string;
  municipality: string;
  state: string;
  total_area: string;
  ccir?: string;
  registry_office?: string;
  owners: NeighborOwner[];
  mortgages?: NeighborMortgage[];
  pdfs: NeighborPdf[];
  status: 'pending' | 'processing' | 'completed' | 'error';
  error_message?: string;
}

interface BoundariesTabProps {
  formData: any;
  updateField: (path: string, value: any) => void;
  getField: (path: string) => string;
}

export default function BoundariesTab({ formData, updateField, getField }: BoundariesTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [processingKey, setProcessingKey] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const roteiro = getField('boundaries.roteiro') || '';
  const neighbors: NeighborProperty[] = (formData?.boundaries?.neighbors ?? []).map((n: any) => ({
    ...n,
    pdfs: n.pdfs ?? [],
  }));

  const updateNeighbors = (newNeighbors: NeighborProperty[]) => {
    updateField('boundaries.neighbors', newNeighbors);
  };

  const addNeighbor = () => {
    updateNeighbors([
      ...neighbors,
      {
        registration_number: '',
        denomination: '',
        municipality: '',
        state: '',
        total_area: '',
        owners: [],
        pdfs: [],
        status: 'pending',
      },
    ]);
  };

  const removeNeighbor = (index: number) => {
    updateNeighbors(neighbors.filter((_, i) => i !== index));
  };

  const updateNeighborField = (index: number, field: string, value: any) => {
    const updated = [...neighbors];
    updated[index] = { ...updated[index], [field]: value };
    updateNeighbors(updated);
  };

  const removePdf = (neighborIndex: number, pdfIndex: number) => {
    const updated = [...neighbors];
    updated[neighborIndex] = {
      ...updated[neighborIndex],
      pdfs: updated[neighborIndex].pdfs.filter((_, i) => i !== pdfIndex),
    };
    updateNeighbors(updated);
  };

  const processNeighborPdf = async (index: number, file: File) => {
    if (!user) return;
    const key = `${index}-${Date.now()}`;
    setProcessingKey(key);
    setProgress(10);

    // Add PDF entry immediately
    const pdfEntry: NeighborPdf = {
      file_name: file.name,
      pdf_path: '',
      status: 'processing',
    };
    const updated = [...neighbors];
    updated[index] = {
      ...updated[index],
      pdfs: [...updated[index].pdfs, pdfEntry],
      status: 'processing',
    };
    updateNeighbors(updated);
    const pdfIdx = updated[index].pdfs.length - 1;

    try {
      const filePath = `${user.id}/neighbor_${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from('matriculas').upload(filePath, file);
      if (uploadError) throw uploadError;
      setProgress(30);

      setProgress(50);
      const { data: funcData, error: funcError } = await supabase.functions.invoke('process-matricula', {
        body: { analysisId: null, pdfPath: filePath },
      });
      if (funcError) throw funcError;
      setProgress(90);

      const extracted = funcData.extracted_data;
      const ident = extracted?.identification ?? {};
      const owners: NeighborOwner[] = (extracted?.owners ?? []).map((o: any) => ({
        name: o.name || '',
        cpf_cnpj: o.cpf_cnpj || '',
        rg: o.rg || '',
        marital_status: o.marital_status || '',
        marriage_regime: o.marriage_regime || '',
        vigencia_lei_divorcio: o.vigencia_lei_divorcio,
        spouse: o.spouse || undefined,
        fonte_dados_documentais: o.fonte_dados_documentais,
        verificar_titularidade: o.verificar_titularidade,
      }));

      // Deduplicação: quando dois proprietários são casados entre si,
      // mesclar o segundo como cônjuge do primeiro.
      const deduped: NeighborOwner[] = [];
      const removedIdx = new Set();
      const norm = (s: string | null | undefined) =>
        (s ?? '').replace(/\D/g, '').trim().toUpperCase();

      for (let i = 0; i < owners.length; i++) {
        if (removedIdx.has(i)) continue;
        const a = { ...owners[i] };
        const aConjugeCpf = norm(a.spouse?.cpf);
        const aConjugeNome = (a.spouse?.name ?? '').trim().toUpperCase();
        for (let j = i + 1; j < owners.length; j++) {
          if (removedIdx.has(j)) continue;
          const b = owners[j];
          const bCpf = norm(b.cpf_cnpj);
          const bNome = (b.name ?? '').trim().toUpperCase();
          const match =
            (aConjugeCpf && bCpf && aConjugeCpf === bCpf) ||
            (aConjugeNome && bNome && aConjugeNome === bNome);
          if (match) {
            if (!a.spouse) a.spouse = {} as any;
            if (!a.spouse!.name && b.name) a.spouse!.name = b.name;
            if (!a.spouse!.cpf && b.cpf_cnpj) a.spouse!.cpf = b.cpf_cnpj;
            if (!a.spouse!.rg && b.rg) a.spouse!.rg = b.rg;
            removedIdx.add(j);
            break;
          }
        }
        deduped.push(a);
      }
      // Hipotecas M5/R8 podem vir como array de objetos
      const mortgages: NeighborMortgage[] = Array.isArray(extracted?.encumbrances?.mortgage)
        ? extracted.encumbrances.mortgage
        : [];

      // Re-read neighbors to avoid stale state
      const freshNeighbors = [...neighbors];
      const n = { ...freshNeighbors[index] };
      const freshPdfs = [...(n.pdfs || [])];
      freshPdfs[pdfIdx] = { file_name: file.name, pdf_path: filePath, status: 'completed' };
      n.pdfs = freshPdfs;

      // Merge extracted data (latest PDF wins for fields)
      n.denomination = ident.denomination || n.denomination;
      n.municipality = ident.municipality || n.municipality;
      n.state = ident.state || n.state;
      n.total_area = ident.total_area || n.total_area;
      n.registration_number = ident.registration_number || n.registration_number;
      n.ccir = ident.ccir || n.ccir;
      n.registry_office = ident.registry_office || n.registry_office;
      // Merge owners — chave por CPF, fallback nome
      const existingKeys = new Set(n.owners.map(o => o.cpf_cnpj || o.name));
      for (const owner of deduped) {
        const key = owner.cpf_cnpj || owner.name;
        if (!existingKeys.has(key)) {
          n.owners.push(owner);
        }
      }
      // Merge hipotecas — substitui (matrícula mais recente é fonte da verdade)
      if (mortgages.length > 0) n.mortgages = mortgages;
      n.status = 'completed';
      freshNeighbors[index] = n;
      updateNeighbors(freshNeighbors);
      setProgress(100);

      toast({ title: `Matrícula "${file.name}" analisada com sucesso!` });
    } catch (e: any) {
      // Mark PDF as error
      const errNeighbors = [...neighbors];
      const en = { ...errNeighbors[index] };
      const errPdfs = [...(en.pdfs || [])];
      if (errPdfs[pdfIdx]) {
        errPdfs[pdfIdx] = { ...errPdfs[pdfIdx], status: 'error', error_message: e.message };
      }
      en.pdfs = errPdfs;
      en.status = en.pdfs.some(p => p.status === 'completed') ? 'completed' : 'error';
      errNeighbors[index] = en;
      updateNeighbors(errNeighbors);
      toast({ title: 'Erro ao processar matrícula', description: e.message, variant: 'destructive' });
    } finally {
      setProcessingKey(null);
      setProgress(0);
    }
  };

  const handleMultipleFiles = (index: number, files: FileList) => {
    Array.from(files).forEach((file, fi) => {
      setTimeout(() => processNeighborPdf(index, file), fi * 500);
    });
  };

  return (
    <div className="space-y-6">
      {/* Roteiro completo */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            Roteiro da Matrícula
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label className="text-xs">Descrição perimétrica completa</Label>
              {roteiro && <span title="Preenchido pela IA"><Bot className="w-3 h-3 text-primary" /></span>}
            </div>
            <Textarea
              value={roteiro}
              onChange={e => updateField('boundaries.roteiro', e.target.value)}
              className="text-sm min-h-[160px] font-mono leading-relaxed"
              placeholder="O roteiro completo da matrícula será extraído automaticamente pela IA..."
              rows={8}
            />
          </div>
        </CardContent>
      </Card>

      {/* Confrontantes */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Building className="w-4 h-4 text-primary" />
              Imóveis Confrontantes ({neighbors.length})
            </CardTitle>
            <Button variant="outline" size="sm" onClick={addNeighbor}>
              + Adicionar Confrontante
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Faça upload de uma ou mais matrículas por confrontante para extrair automaticamente os dados atualizados
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {neighbors.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Building className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Nenhum confrontante cadastrado</p>
              <p className="text-xs mt-1">Clique em "Adicionar Confrontante" para inserir as matrículas vizinhas</p>
            </div>
          )}

          {neighbors.map((neighbor, i) => (
            <div key={i} className="border border-border rounded-lg overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between bg-muted/50 px-4 py-2.5">
                <span className="text-sm font-semibold text-primary">Confrontante {i + 1}</span>
                <div className="flex items-center gap-2">
                  {neighbor.pdfs.length > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                      {neighbor.pdfs.length} matrícula{neighbor.pdfs.length > 1 ? 's' : ''}
                    </span>
                  )}
                  {neighbor.status === 'completed' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                      ✓ Analisado
                    </span>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeNeighbor(i)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <div className="p-4 space-y-4">
                {/* Registration number */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Nº da Matrícula</Label>
                  <Input
                    value={neighbor.registration_number}
                    onChange={e => updateNeighborField(i, 'registration_number', e.target.value)}
                    placeholder="Ex: 12345"
                    className="text-sm h-9"
                  />
                </div>

                {/* PDFs list */}
                {neighbor.pdfs.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Matrículas enviadas</Label>
                    {neighbor.pdfs.map((pdf, pi) => (
                      <div key={pi} className="flex items-center gap-2 text-xs bg-muted/30 rounded-md px-3 py-2">
                        <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{pdf.file_name}</span>
                        {pdf.status === 'processing' && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
                        {pdf.status === 'completed' && <span className="text-primary font-medium">✓</span>}
                        {pdf.status === 'error' && (
                          <span className="text-destructive font-medium" title={pdf.error_message}>✗</span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 shrink-0"
                          onClick={() => removePdf(i, pi)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Upload button - always visible */}
                <div>
                  <input
                    id={`neighbor-pdf-${i}`}
                    type="file"
                    accept=".pdf"
                    multiple
                    className="hidden"
                    onChange={e => {
                      if (e.target.files && e.target.files.length > 0) {
                        handleMultipleFiles(i, e.target.files);
                        e.target.value = '';
                      }
                    }}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-9"
                    disabled={processingKey !== null}
                    onClick={() => document.getElementById(`neighbor-pdf-${i}`)?.click()}
                  >
                    {processingKey?.startsWith(`${i}-`) ? (
                      <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Analisando...</>
                    ) : (
                      <><Plus className="w-3.5 h-3.5 mr-1.5" />Adicionar Matrícula(s)</>
                    )}
                  </Button>
                </div>

                {/* Progress bar when processing */}
                {processingKey?.startsWith(`${i}-`) && (
                  <div className="space-y-1">
                    <Progress value={progress} className="h-1.5" />
                    <p className="text-xs text-muted-foreground">Processando matrícula com IA...</p>
                  </div>
                )}

                {/* Extracted data */}
                {(neighbor.status === 'completed' || neighbor.denomination) && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Denominação</Label>
                        <Input
                          value={neighbor.denomination}
                          onChange={e => updateNeighborField(i, 'denomination', e.target.value)}
                          className="text-sm h-9"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Área Total (ha)</Label>
                        <Input
                          value={neighbor.total_area}
                          onChange={e => updateNeighborField(i, 'total_area', e.target.value)}
                          className="text-sm h-9"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Município</Label>
                        <Input
                          value={neighbor.municipality}
                          onChange={e => updateNeighborField(i, 'municipality', e.target.value)}
                          className="text-sm h-9"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">UF</Label>
                        <Input
                          value={neighbor.state}
                          onChange={e => updateNeighborField(i, 'state', e.target.value)}
                          className="text-sm h-9"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">CCIR</Label>
                        <Input
                          value={neighbor.ccir ?? ''}
                          onChange={e => updateNeighborField(i, 'ccir', e.target.value)}
                          className="text-sm h-9"
                          placeholder="Número do CCIR"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Cartório de registro</Label>
                        <Input
                          value={neighbor.registry_office ?? ''}
                          onChange={e => updateNeighborField(i, 'registry_office', e.target.value)}
                          className="text-sm h-9"
                        />
                      </div>
                    </div>

                    {/* Owners — agora com regime, cônjuge e badges M5/R8 */}
                    {neighbor.owners.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold flex items-center gap-1.5">
                          <User className="w-3 h-3" /> Proprietários Atuais
                        </Label>
                        {neighbor.owners.map((owner, oi) => {
                          const updateOwnerPatch = (patch: Partial<NeighborOwner>) => {
                            const updatedOwners = [...neighbor.owners];
                            updatedOwners[oi] = { ...updatedOwners[oi], ...patch };
                            updateNeighborField(i, 'owners', updatedOwners);
                          };
                          const updateSpousePatch = (patch: any) => {
                            const updatedOwners = [...neighbor.owners];
                            updatedOwners[oi] = {
                              ...updatedOwners[oi],
                              spouse: { ...(updatedOwners[oi].spouse ?? {}), ...patch },
                            };
                            updateNeighborField(i, 'owners', updatedOwners);
                          };
                          const isMarried = (owner.marital_status ?? '').toLowerCase().startsWith('cas');
                          return (
                            <div key={oi} className="space-y-2 pl-3 border-l-2 border-primary/20">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-semibold text-primary">Proprietário {oi + 1}</span>
                                {owner.fonte_dados_documentais === 'averbacao_anterior' && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-info/10 text-info border border-info/30">
                                    dados de averbação anterior
                                  </span>
                                )}
                                {owner.fonte_dados_documentais === 'nao_encontrado' && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/30">
                                    CPF/RG não encontrado
                                  </span>
                                )}
                                {owner.verificar_titularidade && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/30">
                                    ⚠ verificar titularidade
                                  </span>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <Label className="text-xs text-muted-foreground">Nome</Label>
                                  <Input value={owner.name} onChange={e => updateOwnerPatch({ name: e.target.value })} className="text-sm h-8" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs text-muted-foreground">CPF/CNPJ</Label>
                                  <Input value={owner.cpf_cnpj} onChange={e => updateOwnerPatch({ cpf_cnpj: e.target.value })} className="text-sm h-8" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs text-muted-foreground">RG</Label>
                                  <Input value={owner.rg ?? ''} onChange={e => updateOwnerPatch({ rg: e.target.value })} className="text-sm h-8" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs text-muted-foreground">Estado civil</Label>
                                  <Input value={owner.marital_status ?? ''} onChange={e => updateOwnerPatch({ marital_status: e.target.value })} className="text-sm h-8" />
                                </div>
                                <div className="col-span-2 space-y-1">
                                  <Label className="text-xs text-muted-foreground">Regime de casamento</Label>
                                  {/* F3 — Regime + Lei 6.515/77 no MESMO campo (sem badge separado) */}
                                  <Input
                                    value={(() => {
                                      const r = (owner.marriage_regime ?? '').toString().trim();
                                      if (!r) return '';
                                      if (owner.vigencia_lei_divorcio === 'apos_vigencia') return `${r} (pós Lei 6.515/77)`;
                                      if (owner.vigencia_lei_divorcio === 'antes_da_vigencia') return `${r} (anterior à Lei 6.515/77)`;
                                      return r;
                                    })()}
                                    onChange={e => updateOwnerPatch({ marriage_regime: e.target.value, vigencia_lei_divorcio: undefined })}
                                    className="text-sm h-8"
                                  />
                                </div>
                              </div>
                              {isMarried && (
                                <div className="grid grid-cols-3 gap-2 pl-3 border-l border-border">
                                  <div className="space-y-1">
                                    <Label className="text-[10px] text-muted-foreground">Cônjuge</Label>
                                    <Input value={owner.spouse?.name ?? ''} onChange={e => updateSpousePatch({ name: e.target.value })} className="text-sm h-7" />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-[10px] text-muted-foreground">CPF cônjuge</Label>
                                    <Input value={owner.spouse?.cpf ?? ''} onChange={e => updateSpousePatch({ cpf: e.target.value })} className="text-sm h-7" />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-[10px] text-muted-foreground">RG cônjuge</Label>
                                    <Input value={owner.spouse?.rg ?? ''} onChange={e => updateSpousePatch({ rg: e.target.value })} className="text-sm h-7" />
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Hipotecas M5/R8 */}
                    {neighbor.mortgages && neighbor.mortgages.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold">Hipotecas ({neighbor.mortgages.length})</Label>
                        <div className="border border-border rounded-md overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-muted/50">
                              <tr>
                                <th className="text-left p-2 font-medium">Ato origem</th>
                                <th className="text-left p-2 font-medium">Status</th>
                                <th className="text-left p-2 font-medium">Cancelamento</th>
                              </tr>
                            </thead>
                            <tbody>
                              {neighbor.mortgages.map((m, mi) => (
                                <tr key={mi} className="border-t border-border">
                                  <td className="p-2 font-mono">{m.ato_origem ?? '—'}</td>
                                  <td className="p-2">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                      m.status_hipoteca === 'ativa' ? 'bg-destructive/10 text-destructive border border-destructive/30' :
                                      m.status_hipoteca === 'cancelada' ? 'bg-success/10 text-success border border-success/30' :
                                      'bg-warning/10 text-warning border border-warning/30'
                                    }`}>
                                      {m.status_hipoteca ?? 'indefinida'}
                                    </span>
                                  </td>
                                  <td className="p-2 font-mono text-muted-foreground">{m.ato_cancelamento ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
