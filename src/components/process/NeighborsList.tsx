import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import NeighborForm, { NeighborFormData, emptyNeighbor } from './NeighborForm';
import { consentLabels, consentColors } from '@/lib/processStages';
import { Plus, ChevronDown, Trash2, Edit, UserPlus, FileSearch, Loader2, AlertTriangle, Info } from 'lucide-react';

interface Props { processId: string; clientId: string; }

export default function NeighborsList({ processId, clientId: _clientId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<NeighborFormData>(emptyNeighbor());
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  const { data: neighbors = [] } = useQuery({
    queryKey: ['neighbors', processId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('process_neighbors')
        .select('*')
        .eq('process_id', processId)
        .order('created_at');
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...form, phones: form.phones as any, birth_date: form.birth_date || null };
      if (editingId) {
        const { error } = await supabase.from('process_neighbors').update(payload as any).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('process_neighbors')
          .insert({ ...payload, process_id: processId, created_by: user!.id } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['neighbors', processId] });
      setOpen(false); setEditingId(null); setForm(emptyNeighbor());
      toast({ title: editingId ? 'Confrontante atualizado' : 'Confrontante adicionado' });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('process_neighbors').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['neighbors', processId] });
      toast({ title: 'Confrontante removido' });
    },
  });

  const convertToClient = useMutation({
    mutationFn: async (n: any) => {
      const { data: cli, error } = await supabase
        .from('clients')
        .insert({
          name: n.full_name, cpf_cnpj: n.cpf_cnpj, email: n.email,
          phone: n.phones?.[0]?.number ?? null,
          notes: `Convertido do processo. Endereço: ${n.address ?? ''}`,
          created_by: user!.id,
        })
        .select('id').single();
      if (error) throw error;
      await supabase.from('process_neighbors').update({ converted_client_id: cli.id }).eq('id', n.id);
      return cli.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['neighbors', processId] });
      toast({ title: 'Confrontante convertido em cliente' });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  // Upload de matrícula de confrontante → análise via IA dedicada
  const analyzeMatricula = async (neighborId: string, file: File) => {
    setAnalyzingId(neighborId);
    try {
      // 1. Upload PDF para storage
      const pdfPath = `confrontantes/${processId}/${neighborId}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from('matriculas').upload(pdfPath, file);
      if (upErr) throw upErr;

      // 2. Chamar edge function dedicada
      const { data, error } = await supabase.functions.invoke('analyze-neighbor-matricula', {
        body: { pdfPath },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // 3. Atualizar registro do confrontante com dados extraídos
      const proprietario = data.proprietarios_atuais?.[0] ?? {};
      const existingPdfs = neighbors.find((n: any) => n.id === neighborId)?.pdfs ?? [];
      const newPdfEntry = {
        path: pdfPath,
        filename: file.name,
        analyzed_at: new Date().toISOString(),
        extracted: data,
      };

      const updates: any = {
        pdfs: [...(existingPdfs as any[]), newPdfEntry],
        extracted_data: data,
      };
      // Preenche campos vazios com dados extraídos (não sobrescreve dados manuais)
      if (!neighbors.find((n: any) => n.id === neighborId)?.full_name && proprietario.nome) {
        updates.full_name = proprietario.nome;
      }
      if (proprietario.cpf) updates.cpf_cnpj = proprietario.cpf;
      if (proprietario.rg) updates.rg = proprietario.rg;
      if (proprietario.rg_orgao) updates.rg_issuer = proprietario.rg_orgao;
      if (proprietario.estado_civil) updates.marital_status = proprietario.estado_civil;
      if (proprietario.regime_casamento) updates.marriage_regime = proprietario.regime_casamento;
      if (proprietario.conjuge_nome) updates.spouse_name = proprietario.conjuge_nome;
      if (proprietario.conjuge_cpf) updates.spouse_cpf = proprietario.conjuge_cpf;
      if (data.matricula_numero) updates.registration_number = data.matricula_numero;
      if (data.cartorio) updates.registry_office = data.cartorio;
      if (data.ccir) updates.ccir_number = data.ccir;
      if (data.denominacao_imovel) updates.property_denomination = data.denominacao_imovel;
      if (proprietario.verificar_titularidade) updates.needs_title_check = true;

      const { error: updErr } = await supabase.from('process_neighbors').update(updates).eq('id', neighborId);
      if (updErr) throw updErr;

      qc.invalidateQueries({ queryKey: ['neighbors', processId] });

      const fonteAlert = proprietario.fonte_dados_documentais === 'averbacao_anterior'
        ? ' (dados encontrados em averbação anterior)'
        : '';
      toast({
        title: 'Matrícula analisada',
        description: `${proprietario.nome ?? 'Proprietário identificado'}${fonteAlert}`,
      });
    } catch (e: any) {
      console.error('Erro ao analisar matrícula:', e);
      toast({
        title: 'Erro na análise',
        description: e.message ?? 'Falha desconhecida',
        variant: 'destructive',
      });
    } finally {
      setAnalyzingId(null);
    }
  };

  const openEdit = (n: any) => {
    setEditingId(n.id);
    setForm({
      positions: n.positions ?? [], neighbor_type: n.neighbor_type ?? 'pf',
      full_name: n.full_name ?? '', cpf_cnpj: n.cpf_cnpj ?? '',
      rg: n.rg ?? '', rg_issuer: n.rg_issuer ?? '',
      birth_date: n.birth_date ?? '', marital_status: n.marital_status ?? '',
      marriage_regime: n.marriage_regime ?? '',
      spouse_name: n.spouse_name ?? '', spouse_cpf: n.spouse_cpf ?? '', spouse_rg: n.spouse_rg ?? '',
      address: n.address ?? '', phones: n.phones ?? [], email: n.email ?? '',
      car_number: n.car_number ?? '', registration_number: n.registration_number ?? '',
      registry_office: n.registry_office ?? '', ccir_number: n.ccir_number ?? '',
      property_denomination: n.property_denomination ?? '', notes: n.notes ?? '',
    });
    setOpen(true);
  };

  const openNew = () => { setEditingId(null); setForm(emptyNeighbor()); setOpen(true); };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{neighbors.length} confrontante(s) cadastrado(s)</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-1.5" />Adicionar</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? 'Editar confrontante' : 'Novo confrontante'}</DialogTitle>
            </DialogHeader>
            <NeighborForm data={form} onChange={setForm} />
            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {neighbors.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
          Nenhum confrontante cadastrado
        </div>
      ) : (
        <div className="space-y-2">
          {neighbors.map((n: any) => {
            const extracted = n.extracted_data ?? {};
            const proprietario = extracted.proprietarios_atuais?.[0];
            const fonteAverbacao = proprietario?.fonte_dados_documentais === 'averbacao_anterior';
            const pdfsCount = (n.pdfs ?? []).length;

            return (
              <Card key={n.id}>
                <Collapsible>
                  <div className="flex items-center justify-between p-3">
                    <CollapsibleTrigger className="flex items-center gap-2 flex-1 text-left">
                      <ChevronDown className="w-4 h-4 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{n.full_name || '(sem nome)'}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {n.positions?.length > 0 && (
                            <span className="text-xs text-muted-foreground">{n.positions.join(', ')}</span>
                          )}
                          <span className={`text-xs px-1.5 py-0.5 rounded ${consentColors[n.consent_status]}`}>
                            {consentLabels[n.consent_status]}
                          </span>
                          {pdfsCount > 0 && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                              {pdfsCount} matrícula(s)
                            </span>
                          )}
                          {n.needs_title_check && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-warning/15 text-warning flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> Verificar titularidade
                            </span>
                          )}
                          {n.converted_client_id && (
                            <span className="text-xs text-success">✓ Cliente</span>
                          )}
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <div className="flex items-center gap-1 shrink-0">
                      <label className="cursor-pointer">
                        <input
                          type="file" accept="application/pdf" className="hidden"
                          disabled={analyzingId === n.id}
                          onChange={e => {
                            const f = e.target.files?.[0];
                            if (f) analyzeMatricula(n.id, f);
                            e.target.value = '';
                          }}
                        />
                        <Button
                          asChild variant="ghost" size="sm"
                          disabled={analyzingId === n.id}
                          title="Analisar matrícula deste confrontante"
                        >
                          <span>
                            {analyzingId === n.id
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <FileSearch className="w-4 h-4" />}
                          </span>
                        </Button>
                      </label>
                      {n.neighbor_type === 'pf' && !n.converted_client_id && n.full_name && (
                        <Button variant="ghost" size="sm" onClick={() => convertToClient.mutate(n)} title="Converter em cliente">
                          <UserPlus className="w-4 h-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => openEdit(n)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => {
                        if (confirm('Remover confrontante?')) remove.mutate(n.id);
                      }}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <CollapsibleContent>
                    <CardContent className="pt-0 text-xs space-y-1.5 border-t border-border pb-3">
                      {n.cpf_cnpj && (
                        <p className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">CPF/CNPJ:</span> {n.cpf_cnpj}
                          {fonteAverbacao && (
                            <span title="Encontrado em averbação anterior">
                              <Info className="w-3 h-3 text-info" />
                            </span>
                          )}
                        </p>
                      )}
                      {n.rg && <p><span className="text-muted-foreground">RG:</span> {n.rg} {n.rg_issuer && `— ${n.rg_issuer}`}</p>}
                      {n.address && <p><span className="text-muted-foreground">Endereço:</span> {n.address}</p>}
                      {n.email && <p><span className="text-muted-foreground">E-mail:</span> {n.email}</p>}
                      {n.car_number && <p><span className="text-muted-foreground">CAR:</span> <span className="font-mono">{n.car_number}</span></p>}
                      {n.registration_number && <p><span className="text-muted-foreground">Matrícula:</span> {n.registration_number}</p>}
                      {n.registry_office && <p><span className="text-muted-foreground">Cartório:</span> {n.registry_office}</p>}
                      {n.ccir_number && <p><span className="text-muted-foreground">CCIR:</span> {n.ccir_number}</p>}
                      {n.spouse_name && <p><span className="text-muted-foreground">Cônjuge:</span> {n.spouse_name}</p>}

                      {extracted.alertas?.length > 0 && (
                        <div className="mt-2 p-2 bg-warning/10 border-l-2 border-warning rounded-sm space-y-0.5">
                          <p className="font-medium text-warning flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Alertas da análise</p>
                          {extracted.alertas.map((a: string, i: number) => (
                            <p key={i} className="text-warning/80">• {a}</p>
                          ))}
                        </div>
                      )}
                      {n.notes && <p className="pt-1 text-muted-foreground">{n.notes}</p>}
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
