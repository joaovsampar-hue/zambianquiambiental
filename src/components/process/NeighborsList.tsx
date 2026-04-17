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
import { Plus, ChevronDown, Trash2, Edit, UserPlus } from 'lucide-react';

interface Props { processId: string; clientId: string; }

export default function NeighborsList({ processId, clientId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<NeighborFormData>(emptyNeighbor());

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
          {neighbors.map((n: any) => (
            <Card key={n.id}>
              <Collapsible>
                <div className="flex items-center justify-between p-3">
                  <CollapsibleTrigger className="flex items-center gap-2 flex-1 text-left">
                    <ChevronDown className="w-4 h-4" />
                    <div>
                      <p className="font-medium text-sm">{n.full_name || '(sem nome)'}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {n.positions?.length > 0 && (
                          <span className="text-xs text-muted-foreground">{n.positions.join(', ')}</span>
                        )}
                        <span className={`text-xs px-1.5 py-0.5 rounded ${consentColors[n.consent_status]}`}>
                          {consentLabels[n.consent_status]}
                        </span>
                        {n.converted_client_id && (
                          <span className="text-xs text-success">✓ Cliente</span>
                        )}
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <div className="flex items-center gap-1">
                    {n.neighbor_type === 'pf' && !n.converted_client_id && n.full_name && (
                      <Button variant="ghost" size="sm" onClick={() => convertToClient.mutate(n)}>
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
                  <CardContent className="pt-0 text-xs space-y-1 border-t border-border pb-3">
                    {n.cpf_cnpj && <p><span className="text-muted-foreground">CPF/CNPJ:</span> {n.cpf_cnpj}</p>}
                    {n.address && <p><span className="text-muted-foreground">Endereço:</span> {n.address}</p>}
                    {n.email && <p><span className="text-muted-foreground">E-mail:</span> {n.email}</p>}
                    {n.car_number && <p><span className="text-muted-foreground">CAR:</span> <span className="font-mono">{n.car_number}</span></p>}
                    {n.registration_number && <p><span className="text-muted-foreground">Matrícula:</span> {n.registration_number}</p>}
                    {n.notes && <p className="pt-1 text-muted-foreground">{n.notes}</p>}
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
