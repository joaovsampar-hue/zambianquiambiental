import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, MapPin, FileSearch, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function DashboardPage() {
  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const [clients, properties, analyses] = await Promise.all([
        supabase.from('clients').select('id', { count: 'exact', head: true }),
        supabase.from('properties').select('id', { count: 'exact', head: true }),
        supabase.from('analyses').select('id', { count: 'exact', head: true }),
      ]);
      return {
        clients: clients.count ?? 0,
        properties: properties.count ?? 0,
        analyses: analyses.count ?? 0,
      };
    },
  });

  const { data: recentAnalyses } = useQuery({
    queryKey: ['recent-analyses'],
    queryFn: async () => {
      const { data } = await supabase
        .from('analyses')
        .select('id, status, created_at, version, property:properties(denomination, client:clients(name))')
        .order('created_at', { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const statCards = [
    { label: 'Clientes', value: stats?.clients ?? 0, icon: Users, color: 'text-primary' },
    { label: 'Imóveis', value: stats?.properties ?? 0, icon: MapPin, color: 'text-info' },
    { label: 'Análises', value: stats?.analyses ?? 0, icon: FileSearch, color: 'text-success' },
  ];

  const statusMap: Record<string, string> = {
    pending: 'Pendente',
    processing: 'Processando',
    completed: 'Concluída',
    error: 'Erro',
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground text-sm">Visão geral do sistema</p>
        </div>
        <Link to="/new-analysis">
          <Button>Nova Análise</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {statCards.map(s => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-4 p-5">
              <div className={`p-3 rounded-xl bg-muted ${s.color}`}>
                <s.icon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-2xl font-heading font-bold">{s.value}</p>
                <p className="text-sm text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-heading">Análises Recentes</CardTitle>
        </CardHeader>
        <CardContent>
          {recentAnalyses && recentAnalyses.length > 0 ? (
            <div className="space-y-3">
              {recentAnalyses.map((a: any) => (
                <Link
                  key={a.id}
                  to={`/analysis/${a.id}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                >
                  <div>
                    <p className="font-medium text-sm">{a.property?.denomination ?? 'Sem nome'}</p>
                    <p className="text-xs text-muted-foreground">{a.property?.client?.name ?? 'Cliente'} · v{a.version}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    a.status === 'completed' ? 'bg-success/15 text-success' :
                    a.status === 'error' ? 'bg-destructive/15 text-destructive' :
                    a.status === 'processing' ? 'bg-info/15 text-info' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    {statusMap[a.status] ?? a.status}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Nenhuma análise encontrada</p>
              <Link to="/new-analysis" className="text-primary text-sm hover:underline">Criar primeira análise</Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
