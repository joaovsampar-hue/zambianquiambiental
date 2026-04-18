import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import Breadcrumb from '@/components/Breadcrumb';
import PropertyMap from '@/components/map/PropertyMap';
import NeighborsList from '@/components/process/NeighborsList';
import DetectedNeighborsPanel, { type DetectedNeighbor } from '@/components/process/DetectedNeighborsPanel';
import { sanitizeCar } from '@/lib/sicar';
import { STAGES, stageLabel, serviceLabel } from '@/lib/processStages';
import { useToast } from '@/hooks/use-toast';
import { FileText, MapPin } from 'lucide-react';

export default function ProcessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [detected, setDetected] = useState<DetectedNeighbor[]>([]);
  const [selectedNeighbors, setSelectedNeighbors] = useState<Set<string>>(new Set());

  // Sempre que a lista de detectados muda, marca por padrão somente os pendentes.
  // Usamos chave estável (CARs ordenados) pra evitar render loop.
  const detectedKey = detected.map(d => d.car).sort().join('|');

  const { data: process, isLoading } = useQuery({
    queryKey: ['process', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('processes')
        .select('*, client:clients(id,name), property:properties(id,denomination)')
        .eq('id', id!).single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: geometry } = useQuery({
    queryKey: ['process-geo', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('process_geometry').select('*').eq('process_id', id!).maybeSingle();
      return data;
    },
  });

  const { data: analyses = [] } = useQuery({
    queryKey: ['process-analyses', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('analyses')
        .select('id, status, version, created_at')
        .eq('process_id', id!).order('created_at', { ascending: false });
      return data ?? [];
    },
  });

  const updateStage = useMutation({
    mutationFn: async (stage: string) => {
      const { error } = await supabase.from('processes')
        .update({ current_stage: stage, last_activity_at: new Date().toISOString() })
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['process', id] });
      toast({ title: 'Etapa atualizada' });
    },
  });

  const saveGeometry = useMutation({
    mutationFn: async (data: any) => {
      const payload = {
        process_id: id!, geojson: data.geojson, kml_raw: data.kml_raw,
        reference_lat: data.reference_lat, reference_lng: data.reference_lng,
        coordinates_text: data.coordinates_text, source: data.source,
        created_by: user!.id,
      };
      if (geometry) {
        const { error } = await supabase.from('process_geometry').update(payload).eq('id', geometry.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('process_geometry').insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['process-geo', id] }),
  });

  // CARs já cadastrados como confrontantes — usado pra evitar duplicatas
  // no painel de detecção automática.
  const { data: registeredCars = [] } = useQuery({
    queryKey: ['neighbors-cars', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('process_neighbors')
        .select('car_number').eq('process_id', id!);
      return (data ?? []).map(r => r.car_number).filter(Boolean) as string[];
    },
  });

  const registeredSet = useMemo(
    () => new Set(registeredCars.map(c => sanitizeCar(c))),
    [registeredCars],
  );
  const registeredKey = Array.from(registeredSet).sort().join('|');

  // Reseta a seleção padrão sempre que detectados ou cadastrados mudam:
  // todos os pendentes ficam marcados; os já cadastrados, fora.
  useEffect(() => {
    const next = new Set<string>();
    for (const n of detected) {
      if (!registeredSet.has(n.car)) next.add(n.car);
    }
    setSelectedNeighbors(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectedKey, registeredKey]);

  // Insert em lote dos vizinhos selecionados pelo usuário no painel.
  const bulkInsertNeighbors = useMutation({
    mutationFn: async (list: DetectedNeighbor[]) => {
      const rows = list.map(n => ({
        process_id: id!,
        created_by: user!.id,
        car_number: n.car,
        property_denomination: `Imóvel rural — ${n.municipio}/${n.uf} (${n.area.toFixed(2)} ha)`,
        phones: [] as any,
        positions: [],
      }));
      const { error } = await supabase.from('process_neighbors').insert(rows as any);
      if (error) throw error;
      return list.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['neighbors', id] });
      qc.invalidateQueries({ queryKey: ['neighbors-cars', id] });
      toast({ title: `${count} confrontante(s) cadastrado(s) em lote` });
    },
    onError: (err: any) => {
      toast({ title: 'Erro no cadastro em lote', description: err.message, variant: 'destructive' });
    },
  });

  if (isLoading || !process) {
    return <div className="text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[
        { label: 'Processos', to: '/' },
        { label: process.process_number },
      ]} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">
              {process.process_number}
            </span>
            <span className="text-xs text-muted-foreground">{serviceLabel(process.service_type)}</span>
          </div>
          <h1 className="text-2xl font-heading font-bold">
            {process.title || process.property?.denomination || 'Processo'}
          </h1>
          <p className="text-sm text-muted-foreground">
            Cliente: <Link to={`/clients/${process.client.id}`} className="text-primary hover:underline">{process.client.name}</Link>
            {process.car_number && <> · CAR: <span className="font-mono">{process.car_number}</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Etapa:</span>
          <Select value={process.current_stage} onValueChange={v => updateStage.mutate(v)}>
            <SelectTrigger className="w-[200px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="map" className="space-y-4">
        <TabsList>
          <TabsTrigger value="map"><MapPin className="w-4 h-4 mr-1.5" />Mapa</TabsTrigger>
          <TabsTrigger value="neighbors">Confrontantes</TabsTrigger>
          <TabsTrigger value="analyses"><FileText className="w-4 h-4 mr-1.5" />Matrículas</TabsTrigger>
        </TabsList>

        <TabsContent value="map" className="space-y-4">
          <DetectedNeighborsPanel
            detected={detected}
            alreadyRegistered={registeredSet}
            selected={selectedNeighbors}
            onSelectedChange={setSelectedNeighbors}
            onRegister={async (list) => { await bulkInsertNeighbors.mutateAsync(list); }}
            isRegistering={bulkInsertNeighbors.isPending}
          />
          <Card><CardContent className="p-4">
            <PropertyMap
              initialData={geometry ? (geometry as any) : undefined}
              onChange={(d) => saveGeometry.mutate(d)}
              height="600px"
              carNumber={process.car_number ?? undefined}
              registeredNeighbors={registeredSet}
              selectedNeighbors={selectedNeighbors}
              onNeighborToggle={(car) => {
                const sanitized = sanitizeCar(car);
                setSelectedNeighbors(prev => {
                  const next = new Set(prev);
                  if (next.has(sanitized)) next.delete(sanitized);
                  else next.add(sanitized);
                  return next;
                });
              }}
              onNeighborsDetected={(list) => {
                // Normaliza os CARs pra bater com o registeredSet (sanitizeCar = uppercase + trim).
                setDetected(list.map(n => ({ ...n, car: sanitizeCar(n.car) })));
              }}
              onNeighborPick={async (info) => {
                // Inserção rápida na tabela de confrontantes — sem abrir formulário.
                const { error } = await supabase.from('process_neighbors').insert({
                  process_id: id!,
                  created_by: user!.id,
                  car_number: info.car,
                  property_denomination: `Imóvel rural — ${info.municipio}/${info.uf} (${info.area.toFixed(2)} ha)`,
                  phones: [] as any,
                  positions: [],
                } as any);
                if (error) {
                  toast({ title: 'Erro', description: error.message, variant: 'destructive' });
                  return;
                }
                qc.invalidateQueries({ queryKey: ['neighbors', id] });
                qc.invalidateQueries({ queryKey: ['neighbors-cars', id] });
                toast({ title: 'Confrontante listado', description: info.car });
              }}
            />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="neighbors">
          <Card><CardContent className="p-4">
            <NeighborsList
              processId={id!}
              clientId={process.client.id}
              clientName={process.client.name}
              processNumber={process.process_number}
              carNumber={process.car_number ?? undefined}
            />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="analyses">
          <Card><CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{analyses.length} análise(s) de matrícula</p>
              <Link to={`/new-analysis?processId=${id}${process.property?.id ? `&propertyId=${process.property.id}` : ''}`}>
                <Button size="sm">Nova análise de matrícula</Button>
              </Link>
            </div>
            {analyses.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                Nenhuma matrícula analisada ainda
              </div>
            ) : (
              <div className="space-y-2">
                {analyses.map((a: any) => (
                  <Link key={a.id} to={`/analysis/${a.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent/50">
                    <div>
                      <p className="text-sm font-medium">Análise v{a.version}</p>
                      <p className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString('pt-BR')}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      a.status === 'completed' ? 'bg-success/15 text-success' :
                      a.status === 'error' ? 'bg-destructive/15 text-destructive' :
                      'bg-info/15 text-info'
                    }`}>{a.status}</span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
