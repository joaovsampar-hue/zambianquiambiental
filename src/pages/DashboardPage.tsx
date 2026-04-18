import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Link } from 'react-router-dom';
import { Plus, Search, Folder, Users, MapPin, FileSearch } from 'lucide-react';
import { STAGES, stageLabel, serviceLabel } from '@/lib/processStages';
import DeleteButton from '@/components/DeleteButton';
import { useToast } from '@/hooks/use-toast';

const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

export default function DashboardPage() {
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const qc = useQueryClient();
  const { toast } = useToast();

  const deleteProcess = useMutation({
    mutationFn: async (processId: string) => {
      // Limpa dependências antes (sem FK cascade na tabela)
      await supabase.from('analyses').delete().eq('process_id', processId);
      await supabase.from('process_neighbors').delete().eq('process_id', processId);
      await supabase.from('process_geometry').delete().eq('process_id', processId);
      const { error } = await supabase.from('processes').delete().eq('id', processId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-processes'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast({ title: 'Processo excluído' });
    },
    onError: (e: any) => toast({ title: 'Erro ao excluir', description: e.message, variant: 'destructive' }),
  });

  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const [clients, properties, analyses, processes] = await Promise.all([
        supabase.from('clients').select('id', { count: 'exact', head: true }),
        supabase.from('properties').select('id', { count: 'exact', head: true }),
        supabase.from('analyses').select('id', { count: 'exact', head: true }),
        supabase.from('processes').select('id', { count: 'exact', head: true }).eq('status', 'em_andamento'),
      ]);
      return {
        clients: clients.count ?? 0,
        properties: properties.count ?? 0,
        analyses: analyses.count ?? 0,
        processes: processes.count ?? 0,
      };
    },
  });

  const { data: processes = [] } = useQuery({
    queryKey: ['active-processes', search, stageFilter],
    queryFn: async () => {
      let q = supabase
        .from('processes')
        .select('*, client:clients(name), property:properties(denomination)')
        .order('last_activity_at', { ascending: true });
      if (stageFilter !== 'all') q = q.eq('current_stage', stageFilter);
      const { data } = await q;
      let list = data ?? [];
      if (search) {
        const s = search.toLowerCase();
        list = list.filter((p: any) =>
          p.process_number.toLowerCase().includes(s) ||
          (p.title ?? '').toLowerCase().includes(s) ||
          (p.client?.name ?? '').toLowerCase().includes(s) ||
          (p.car_number ?? '').toLowerCase().includes(s)
        );
      }
      return list;
    },
  });

  const statCards = [
    { label: 'Processos ativos', value: stats?.processes ?? 0, icon: Folder, color: 'text-primary' },
    { label: 'Clientes', value: stats?.clients ?? 0, icon: Users, color: 'text-info' },
    { label: 'Imóveis', value: stats?.properties ?? 0, icon: MapPin, color: 'text-success' },
    { label: 'Análises', value: stats?.analyses ?? 0, icon: FileSearch, color: 'text-warning' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading font-bold">Processos ativos</h1>
          <p className="text-muted-foreground text-sm">Visão geral dos processos em andamento</p>
        </div>
        <div className="flex gap-2">
          <Link to="/new-analysis"><Button variant="outline">Análise avulsa</Button></Link>
          <Link to="/new-process"><Button><Plus className="w-4 h-4 mr-1.5" />Novo processo</Button></Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCards.map(s => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className={`p-2.5 rounded-lg bg-muted ${s.color}`}>
                <s.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xl font-heading font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-10" placeholder="Buscar por nº, título, cliente ou CAR..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as etapas</SelectItem>
            {STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {processes.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <Folder className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Nenhum processo encontrado</p>
          <Link to="/new-process" className="text-primary text-sm hover:underline">Criar primeiro processo</Link>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {processes.map((p: any) => {
            const days = daysSince(p.last_activity_at);
            const urgency = days >= 15 ? 'border-destructive/60' : days >= 7 ? 'border-warning/60' : 'border-border';
            return (
              <Link key={p.id} to={`/processes/${p.id}`}>
                <Card className={`hover:border-primary/40 transition-colors cursor-pointer border-l-4 ${urgency}`}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">
                        {p.process_number}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {days === 0 ? 'Hoje' : `${days}d sem atualização`}
                        </span>
                        <DeleteButton
                          iconOnly
                          title="Excluir processo?"
                          description={`Processo ${p.process_number} e todos os confrontantes, análises e geometria vinculados serão removidos.`}
                          onConfirm={async () => { await deleteProcess.mutateAsync(p.id); }}
                        />
                      </div>
                    </div>
                    <div>
                      <p className="font-medium text-sm leading-tight">
                        {p.title || p.property?.denomination || 'Sem título'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{p.client?.name}</p>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-border">
                      <span className="text-xs text-muted-foreground">{serviceLabel(p.service_type)}</span>
                      <span className="text-xs font-medium text-primary">{stageLabel(p.current_stage)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
