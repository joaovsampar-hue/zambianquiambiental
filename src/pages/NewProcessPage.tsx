import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import Breadcrumb from '@/components/Breadcrumb';
import PropertyMap, { MapData, PropertyMapHandle } from '@/components/map/PropertyMap';
import { SERVICE_TYPES, isValidCAR, sanitizeCAR, carUF } from '@/lib/processStages';
import { ArrowRight, ArrowLeft, Check, Loader2, MapPinned, UserPlus } from 'lucide-react';

export default function NewProcessPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const mapHandleRef = useRef<PropertyMapHandle>(null);

  const [step, setStep] = useState(1);
  const [carNumberRaw, setCarNumberRaw] = useState(''); // como digitado (com pontos OK)
  const [clientId, setClientId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [serviceType, setServiceType] = useState('georreferenciamento');
  const [title, setTitle] = useState('');
  const [mapData, setMapData] = useState<MapData>({
    geojson: null, reference_lat: null, reference_lng: null,
    coordinates_text: null, kml_raw: null, source: null,
  });

  // Cadastro inline de cliente novo
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', cpf_cnpj: '', phone: '', email: '' });

  // CAR sanitizado (sem pontos) — usado para validação e persistência
  const carClean = sanitizeCAR(carNumberRaw);
  const carOk = !carClean || isValidCAR(carClean);

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

  const createClientMut = useMutation({
    mutationFn: async () => {
      if (!newClient.name.trim()) throw new Error('Nome do cliente obrigatório');
      const { data, error } = await supabase
        .from('clients')
        .insert({
          name: newClient.name.trim(),
          cpf_cnpj: newClient.cpf_cnpj || null,
          phone: newClient.phone || null,
          email: newClient.email || null,
          created_by: user!.id,
        })
        .select('id, name').single();
      if (error) throw error;
      return data;
    },
    onSuccess: (cli) => {
      qc.invalidateQueries({ queryKey: ['clients-list'] });
      setClientId(cli.id);
      setShowNewClient(false);
      setNewClient({ name: '', cpf_cnpj: '', phone: '', email: '' });
      toast({ title: `Cliente "${cli.name}" criado e vinculado` });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error('Selecione ou crie um cliente');
      const { data: proc, error } = await supabase
        .from('processes')
        .insert({
          client_id: clientId,
          property_id: propertyId || null,
          car_number: carClean || null,
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

  const [locatingCar, setLocatingCar] = useState(false);
  const handleLocateCAR = async () => {
    if (!carClean) {
      toast({ title: 'Digite o número do CAR primeiro', variant: 'destructive' });
      return;
    }
    if (!isValidCAR(carClean)) {
      toast({ title: 'CAR inválido', description: 'Verifique o formato', variant: 'destructive' });
      return;
    }
    if (!mapHandleRef.current) return;
    // Centraliza na UF imediatamente (feedback rápido) e dispara busca WFS no SICAR.
    const uf = carUF(carClean);
    if (uf) mapHandleRef.current.flyToUF(uf);
    setLocatingCar(true);
    try {
      const ok = await mapHandleRef.current.loadCarPolygon(carClean);
      if (!ok) {
        // Toast de erro já é exibido pelo PropertyMap.loadCar; aqui só logamos contexto.
        return;
      }
    } finally {
      setLocatingCar(false);
    }
  };

  const canStep2 = !!clientId && carOk;

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: 'Processos', to: '/' }, { label: 'Novo processo' }]} />
      <div>
        <h1 className="text-2xl font-heading font-bold">Novo Processo</h1>
        <p className="text-muted-foreground text-sm">Inicie um processo de georreferenciamento</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {[1, 2].map(n => (
          <div key={n} className="flex items-center flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step >= n ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}>
              {step > n ? <Check className="w-4 h-4" /> : n}
            </div>
            {n < 2 && <div className={`flex-1 h-0.5 mx-2 ${step > n ? 'bg-primary' : 'bg-muted'}`} />}
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="p-6 space-y-5">
          {step === 1 && (
            <>
              <h2 className="font-heading font-semibold text-lg">1. Identificação do imóvel</h2>

              <div className="grid lg:grid-cols-2 gap-6">
                {/* Coluna esquerda — formulário */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Número do CAR (opcional)</Label>
                    <div className="flex gap-2">
                      <Input
                        value={carNumberRaw}
                        // Sanitiza em tempo real: remove pontos e força maiúsculas
                        onChange={e => setCarNumberRaw(e.target.value.replace(/\./g, '').toUpperCase())}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleLocateCAR(); } }}
                        placeholder="UF-XXXXXXX-XXXXXXXX..."
                        className={!carOk ? 'border-destructive font-mono text-xs' : 'font-mono text-xs'}
                      />
                      <Button type="button" variant="outline" size="sm" onClick={handleLocateCAR}>
                        <MapPinned className="w-4 h-4 mr-1.5" /> Localizar
                      </Button>
                    </div>
                    {!carOk && (
                      <p className="text-xs text-destructive">
                        Formato inválido. Aceito com ou sem pontos: UF-7dígitos-32hex.
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Aceita o número com ou sem pontos. Pressione Enter ou clique em Localizar para centralizar o mapa.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Cliente *</Label>
                      <Button
                        type="button" variant="ghost" size="sm"
                        onClick={() => { setShowNewClient(s => !s); setClientId(''); }}
                      >
                        <UserPlus className="w-3.5 h-3.5 mr-1" />
                        {showNewClient ? 'Selecionar existente' : 'Criar novo'}
                      </Button>
                    </div>

                    {!showNewClient ? (
                      <Select value={clientId} onValueChange={v => { setClientId(v); setPropertyId(''); }}>
                        <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                        <SelectContent>
                          {clients?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Card className="bg-muted/30">
                        <CardContent className="p-3 space-y-2">
                          <Input
                            placeholder="Nome completo *"
                            value={newClient.name}
                            onChange={e => setNewClient({ ...newClient, name: e.target.value })}
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              placeholder="CPF/CNPJ"
                              value={newClient.cpf_cnpj}
                              onChange={e => setNewClient({ ...newClient, cpf_cnpj: e.target.value })}
                            />
                            <Input
                              placeholder="Telefone"
                              value={newClient.phone}
                              onChange={e => setNewClient({ ...newClient, phone: e.target.value })}
                            />
                          </div>
                          <Input
                            type="email" placeholder="E-mail"
                            value={newClient.email}
                            onChange={e => setNewClient({ ...newClient, email: e.target.value })}
                          />
                          <Button
                            size="sm" type="button"
                            onClick={() => createClientMut.mutate()}
                            disabled={createClientMut.isPending || !newClient.name.trim()}
                          >
                            {createClientMut.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                            Criar e vincular cliente
                          </Button>
                          <p className="text-xs text-muted-foreground">
                            Você poderá complementar o cadastro depois na ficha do cliente.
                          </p>
                        </CardContent>
                      </Card>
                    )}
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

                  <div className="grid grid-cols-2 gap-3">
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
                      <Label>Título interno</Label>
                      <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Faz. São João" />
                    </div>
                  </div>
                </div>

                {/* Coluna direita — mapa */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Localize visualmente o imóvel — ative a camada CAR no painel do mapa
                  </Label>
                  <PropertyMap
                    ref={mapHandleRef}
                    initialData={mapData}
                    onChange={setMapData}
                    height="500px"
                  />
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="font-heading font-semibold text-lg">2. Revisar e criar</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between border-b border-border pb-2">
                  <span className="text-muted-foreground">Cliente</span>
                  <span className="font-medium">{clients?.find(c => c.id === clientId)?.name}</span>
                </div>
                <div className="flex justify-between border-b border-border pb-2">
                  <span className="text-muted-foreground">Tipo de serviço</span>
                  <span className="font-medium">{SERVICE_TYPES.find(s => s.key === serviceType)?.label}</span>
                </div>
                {carClean && (
                  <div className="flex justify-between border-b border-border pb-2">
                    <span className="text-muted-foreground">CAR</span>
                    <span className="font-mono text-xs">{carClean}</span>
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
            {step < 2 ? (
              <Button onClick={() => setStep(step + 1)} disabled={!canStep2}>
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
