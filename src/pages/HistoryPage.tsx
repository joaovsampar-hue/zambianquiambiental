import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Search, FileSearch } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function HistoryPage() {
  const [search, setSearch] = useState('');

  const { data: analyses, isLoading } = useQuery({
    queryKey: ['all-analyses', search],
    queryFn: async () => {
      const { data } = await supabase
        .from('analyses')
        .select('id, status, version, created_at, property:properties(denomination, registration_number, client:clients(name))')
        .order('created_at', { ascending: false });
      if (!data) return [];
      if (!search) return data;
      const s = search.toLowerCase();
      return data.filter((a: any) =>
        a.property?.denomination?.toLowerCase().includes(s) ||
        a.property?.registration_number?.toLowerCase().includes(s) ||
        a.property?.client?.name?.toLowerCase().includes(s)
      );
    },
  });

  const statusMap: Record<string, string> = {
    pending: 'Pendente',
    processing: 'Processando',
    completed: 'Concluída',
    error: 'Erro',
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-heading font-bold">Histórico de Análises</h1>
        <p className="text-muted-foreground text-sm">Todas as análises realizadas</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por cliente, imóvel ou matrícula..."
          className="pl-10"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Carregando...</div>
      ) : analyses && analyses.length > 0 ? (
        <div className="grid gap-3">
          {analyses.map((a: any) => (
            <Link key={a.id} to={`/analysis/${a.id}`}>
              <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                      <FileSearch className="w-5 h-5 text-success" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{a.property?.denomination ?? 'Sem nome'}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.property?.client?.name} · Mat. {a.property?.registration_number ?? '—'} · v{a.version}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      a.status === 'completed' ? 'bg-success/15 text-success' :
                      a.status === 'error' ? 'bg-destructive/15 text-destructive' :
                      a.status === 'processing' ? 'bg-info/15 text-info' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {statusMap[a.status] ?? a.status}
                    </span>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(a.created_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <FileSearch className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Nenhuma análise encontrada</p>
        </div>
      )}
    </div>
  );
}
