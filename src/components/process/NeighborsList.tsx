import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import PropertyMap from '@/components/map/PropertyMap';
import { exportNeighborsToExcel } from '@/lib/exportNeighbors';
import { Plus, Trash2, FileSpreadsheet, MousePointerClick, MapPin, Edit } from 'lucide-react';

interface Props {
  processId: string;
  clientId: string;
  /** Nome do cliente — usado no cabeçalho do Excel exportado. */
  clientName?: string;
  /** Número do processo — incluso no Excel para referência. */
  processNumber?: string;
  /** CAR do imóvel principal — habilita o mapa de identificação de confrontantes. */
  carNumber?: string;
}

const POSITIONS = ['N', 'S', 'L', 'O', 'NE', 'NO', 'SE', 'SO'];

interface MiniForm {
  full_name: string;
  registration_number: string;
  phone: string;
  positions: string[];
  car_number: string;
  registry_office: string;
  property_denomination: string;
}

const emptyMini = (): MiniForm => ({
  full_name: '',
  registration_number: '',
  phone: '',
  positions: [],
  car_number: '',
  registry_office: '',
  property_denomination: '',
});

export default function NeighborsList({ processId, clientName, processNumber, carNumber }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MiniForm>(emptyMini());
  const [showMap, setShowMap] = useState(false);
  // Confrontantes diretos detectados pelo SICAR (TOUCHES) que ainda não foram cadastrados.
  const [detected, setDetected] = useState<Array<{ car: string; area: number; municipio: string; uf: string }>>([]);

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

  // CARs já cadastrados — usado para esconder da lista de "detectados" os que já entraram.
  const registeredCars = useMemo(
    () => new Set((neighbors as any[]).map(n => n.car_number).filter(Boolean)),
    [neighbors],
  );
  const pendingDetected = useMemo(
    () => detected.filter(d => !registeredCars.has(d.car)),
    [detected, registeredCars],
  );

  const save = useMutation({
    mutationFn: async () => {
      const phones = form.phone.trim() ? [{ number: form.phone.trim(), whatsapp: true }] : [];
      const payload = {
        full_name: form.full_name || null,
        registration_number: form.registration_number || null,
        phones: phones as any,
        positions: form.positions,
        car_number: form.car_number || null,
        registry_office: form.registry_office || null,
        property_denomination: form.property_denomination || null,
      };
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
      setOpen(false);
      setEditingId(null);
      setForm(emptyMini());
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

  const openNew = () => {
    setEditingId(null);
    setForm(emptyMini());
    setOpen(true);
  };

  const openEdit = (n: any) => {
    setEditingId(n.id);
    setForm({
      full_name: n.full_name ?? '',
      registration_number: n.registration_number ?? '',
      phone: n.phones?.[0]?.number ?? '',
      positions: n.positions ?? [],
      car_number: n.car_number ?? '',
      registry_office: n.registry_office ?? '',
      property_denomination: n.property_denomination ?? '',
    });
    setOpen(true);
  };

  /** Pré-preenche o formulário com dados de um imóvel SICAR clicado no mapa. */
  const openFromMap = (info: { car: string; area: number; municipio: string; uf: string }) => {
    setEditingId(null);
    setForm({
      ...emptyMini(),
      car_number: info.car,
      property_denomination: `Imóvel rural — ${info.municipio}/${info.uf} (${info.area.toFixed(2)} ha)`,
    });
    setOpen(true);
  };

  /** Adiciona direto (sem abrir formulário) um confrontante detectado pelo SICAR. */
  const quickAddDetected = async (d: { car: string; area: number; municipio: string; uf: string }) => {
    const { error } = await supabase.from('process_neighbors').insert({
      process_id: processId,
      created_by: user!.id,
      car_number: d.car,
      property_denomination: `Imóvel rural — ${d.municipio}/${d.uf} (${d.area.toFixed(2)} ha)`,
      phones: [] as any,
      positions: [],
    } as any);
    if (error) {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
      return;
    }
    qc.invalidateQueries({ queryKey: ['neighbors', processId] });
    toast({ title: 'Confrontante adicionado' });
  };

  const togglePos = (p: string) => {
    setForm(f => ({
      ...f,
      positions: f.positions.includes(p) ? f.positions.filter(x => x !== p) : [...f.positions, p],
    }));
  };

  const handleExport = () => {
    if (!neighbors.length) {
      toast({ title: 'Nada a exportar', description: 'Cadastre confrontantes primeiro.' });
      return;
    }
    exportNeighborsToExcel({
      clientName: clientName ?? 'Cliente',
      processNumber,
      neighbors: neighbors as any,
    });
    toast({ title: 'Planilha gerada', description: 'O download foi iniciado.' });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {neighbors.length} confrontante(s) cadastrado(s)
          {pendingDetected.length > 0 && (
            <span className="ml-2 text-info">• {pendingDetected.length} detectado(s) pelo SICAR</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleExport} disabled={!neighbors.length}>
            <FileSpreadsheet className="w-4 h-4 mr-1.5" />Exportar Excel
          </Button>
          {carNumber && (
            <Button size="sm" variant="outline" onClick={() => setShowMap(s => !s)}>
              <MousePointerClick className="w-4 h-4 mr-1.5" />
              {showMap ? 'Fechar mapa' : 'Adicionar pelo mapa'}
            </Button>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-1.5" />Adicionar</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingId ? 'Editar confrontante' : 'Novo confrontante'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Nome do proprietário</Label>
                  <Input
                    value={form.full_name}
                    onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                    className="mt-1.5"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Matrícula</Label>
                    <Input
                      value={form.registration_number}
                      onChange={e => setForm(f => ({ ...f, registration_number: e.target.value }))}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Telefone</Label>
                    <Input
                      value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="(00) 00000-0000"
                      className="mt-1.5"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">CAR</Label>
                  <Input
                    value={form.car_number}
                    onChange={e => setForm(f => ({ ...f, car_number: e.target.value.toUpperCase() }))}
                    className="mt-1.5 font-mono text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Cartório</Label>
                    <Input
                      value={form.registry_office}
                      onChange={e => setForm(f => ({ ...f, registry_office: e.target.value }))}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Denominação do imóvel</Label>
                    <Input
                      value={form.property_denomination}
                      onChange={e => setForm(f => ({ ...f, property_denomination: e.target.value }))}
                      className="mt-1.5"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Posição (limite)</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {POSITIONS.map(p => (
                      <button
                        type="button"
                        key={p}
                        onClick={() => togglePos(p)}
                        className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                          form.positions.includes(p)
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-border hover:bg-accent'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {showMap && carNumber && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              Confrontantes diretos aparecem em <strong>azul</strong>. Clique em qualquer imóvel e use <strong>+ Confrontante</strong> no popup para cadastrar.
            </p>
            <PropertyMap
              initialData={{}}
              onChange={() => { /* leitura apenas */ }}
              carNumber={carNumber}
              height="420px"
              onNeighborPick={openFromMap}
              onNeighborsDetected={setDetected}
            />
          </CardContent>
        </Card>
      )}

      {/* Detectados pelo SICAR mas ainda não cadastrados — botão de cadastro rápido */}
      {pendingDetected.length > 0 && (
        <Card className="border-info/40 bg-info/5">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-medium text-info flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              Confrontantes diretos detectados pelo SICAR ({pendingDetected.length})
            </p>
            <div className="space-y-1.5">
              {pendingDetected.map(d => (
                <div key={d.car} className="flex items-center justify-between gap-2 text-xs bg-background border border-border rounded p-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono truncate">{d.car}</p>
                    <p className="text-muted-foreground">{d.municipio}/{d.uf} — {d.area.toFixed(2)} ha</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => quickAddDetected(d)}>
                    <Plus className="w-3.5 h-3.5 mr-1" />Cadastrar
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista enxuta dos confrontantes cadastrados */}
      {neighbors.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
          {carNumber
            ? 'Nenhum confrontante cadastrado. Use "Adicionar pelo mapa" para identificar pelo SICAR.'
            : 'Nenhum confrontante cadastrado. Vincule o CAR do imóvel no passo do mapa para detecção automática.'}
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="text-left p-2 font-medium">Posição</th>
                <th className="text-left p-2 font-medium">Proprietário</th>
                <th className="text-left p-2 font-medium">Matrícula</th>
                <th className="text-left p-2 font-medium">Telefone</th>
                <th className="text-left p-2 font-medium">CAR</th>
                <th className="text-right p-2 font-medium w-20">Ações</th>
              </tr>
            </thead>
            <tbody>
              {(neighbors as any[]).map(n => (
                <tr key={n.id} className="border-t border-border hover:bg-muted/30">
                  <td className="p-2 text-xs">{n.positions?.join(', ') || '—'}</td>
                  <td className="p-2">{n.full_name || <span className="text-muted-foreground italic">sem nome</span>}</td>
                  <td className="p-2 text-xs">{n.registration_number || '—'}</td>
                  <td className="p-2 text-xs">{n.phones?.[0]?.number || '—'}</td>
                  <td className="p-2 text-xs font-mono truncate max-w-[180px]" title={n.car_number || ''}>
                    {n.car_number || '—'}
                  </td>
                  <td className="p-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(n)}>
                      <Edit className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => {
                      if (confirm('Remover confrontante?')) remove.mutate(n.id);
                    }}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
