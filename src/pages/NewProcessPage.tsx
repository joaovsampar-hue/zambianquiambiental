import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import Breadcrumb from '@/components/Breadcrumb';
import PropertyMap, { MapData } from '@/components/map/PropertyMap';
import { SERVICE_TYPES, isValidCAR } from '@/lib/processStages';
import { ArrowRight, ArrowLeft, Check, Loader2 } from 'lucide-react';

export default function NewProcessPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [carNumber, setCarNumber] = useState('');
  const [clientId, setClientId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [serviceType, setServiceType] = useState('georreferenciamento');
  const [title, setTitle] = useState('');
  const [mapData, setMapData] = useState<MapData>({
    geojson: null, reference_lat: null, reference_lng: null,
    coordinates_text: null, kml_raw: null, source: null,
  });

  const { data: clients } = useQuery({
    queryKey: ['clients-list'],
    queryFn: async () => {
      const { data } = await supabase.from('clients').select('id, name').order('name');
      return data ?? [];
    },
  });

  const { data: properties } = useQuery({
    queryKey: ['properties-list', clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data } = await supabase.from('properties').select('id, denomination').eq('client_id', clientId).order('denomination');
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error('Selecione um cliente');
      const { data: proc, error } = await supabase
        .from('processes')
        .insert({
          client_id: clientId,
          property_id: propertyId || null,
          car_number: carNumber || null,
          service_type: serviceType,
          title: title || null,
          current_stage: mapData.geojson || mapData.reference_lat ? 'matricula' : 'mapa',
          created_by: user!.id,
        } as any)
        .select('id, process_number')
        .single();
      if (error) throw error;

      if (mapData.geojson || mapData.reference_lat || mapData.coordinates_text) {
        await supabase.from('process_geometry').insert({
          process_id: proc.id,
          geojson: mapData.geojson,
          kml_raw: mapData.kml_raw,
          reference_lat: mapData.reference_lat,
          reference_lng: mapData.reference_lng,
          coordinates_text: mapData.coordinates_text,
          source: mapData.source,
          created_by: user!.id,
        } as any);
      }

      return proc;
    },
    onSuccess: (proc) => {
      toast({ title: `Processo ${proc.process_number} criado!` });
      navigate(`/processes/${proc.id}`);
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const carOk = !carNumber || isValidCAR(carNumber);
  const canStep2 = !!clientId && carOk;

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: 'Processos', to: '/' }, { label: 'Novo processo' }]} />
      <div>
        <h1 className="text-2xl font-heading font-bold">Novo Processo</h1>
        <p className="text-muted-foreground text-sm">Inicie um processo de georreferenciamento</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {[1, 2, 3].map(n => (
          <div key={n} className="flex items-center flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step >= n ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}>
              {step > n ? <Check className="w-4 h-4" /> : n}
            </div>
            {n < 3 && <div className={`flex-1 h-0.5 mx-2 ${step > n ? 'bg-primary' : 'bg-muted'}`} />}
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="p-6 space-y-5">
          {step === 1 && (
            <>
              <h2 className="font-heading font-semibold text-lg">1. Identificação do imóvel</h2>
              <div className="space-y-2">
                <Label>Número do CAR (opcional)</Label>
                <Input
                  value={carNumber}
                  onChange={e => setCarNumber(e.target.value.toUpperCase())}
                  placeholder="UF-XXXXXXX-XXXX.XXXX.XXXX.XXXX.XXXX"
                  className={!carOk ? 'border-destructive' : ''}
                />
                {!carOk && (
                  <p className="text-xs text-destructive">Formato inválido. Ex: GO-5208707-1234.5678.ABCD.EF12.3456</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Cliente *</Label>
                  <Select value={clientId} onValueChange={v => { setClientId(v); setPropertyId(''); }}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {clients?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Imóvel (opcional)</Label>
                  <Select value={propertyId} onValueChange={setPropertyId} disabled={!clientId}>
                    <SelectTrigger><SelectValue placeholder="Vincular a imóvel..." /></SelectTrigger>
                    <SelectContent>
                      {properties?.map(p => <SelectItem key={p.id} value={p.id}>{p.denomination}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tipo de serviço *</Label>
                  <Select value={serviceType} onValueChange={setServiceType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SERVICE_TYPES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Título interno (opcional)</Label>
                  <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Fazenda São João" />
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="font-heading font-semibold text-lg">2. Mapa & polígono do imóvel</h2>
              <p className="text-sm text-muted-foreground">
                Faça upload de um KML/GeoJSON, insira coordenadas ou marque um ponto de referência. Você pode pular esta etapa e fazer depois.
              </p>
              <PropertyMap initialData={mapData} onChange={setMapData} height="450px" />
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="font-heading font-semibold text-lg">3. Revisar e criar</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between border-b border-border pb-2">
                  <span className="text-muted-foreground">Cliente</span>
                  <span className="font-medium">{clients?.find(c => c.id === clientId)?.name}</span>
                </div>
                <div className="flex justify-between border-b border-border pb-2">
                  <span className="text-muted-foreground">Tipo de serviço</span>
                  <span className="font-medium">{SERVICE_TYPES.find(s => s.key === serviceType)?.label}</span>
                </div>
                {carNumber && (
                  <div className="flex justify-between border-b border-border pb-2">
                    <span className="text-muted-foreground">CAR</span>
                    <span className="font-mono text-xs">{carNumber}</span>
                  </div>
                )}
                <div className="flex justify-between border-b border-border pb-2">
                  <span className="text-muted-foreground">Geometria</span>
                  <span className="font-medium">
                    {mapData.geojson ? '✓ Polígono' : mapData.reference_lat ? '✓ Ponto de referência' : '— Não informada'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground pt-2">
                  Após criar, você poderá fazer upload da matrícula, cadastrar confrontantes e gerar anuências.
                </p>
              </div>
            </>
          )}

          <div className="flex justify-between pt-4 border-t border-border">
            <Button variant="outline" onClick={() => step > 1 ? setStep(step - 1) : navigate(-1)}>
              <ArrowLeft className="w-4 h-4 mr-1.5" /> {step === 1 ? 'Cancelar' : 'Voltar'}
            </Button>
            {step < 3 ? (
              <Button onClick={() => setStep(step + 1)} disabled={step === 1 && !canStep2}>
                Próximo <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            ) : (
              <Button onClick={() => create.mutate()} disabled={create.isPending}>
                {create.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                Criar processo
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
