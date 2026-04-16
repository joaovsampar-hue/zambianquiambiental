import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Save, AlertTriangle, AlertCircle, Info, Bot, FileText, FileDown } from 'lucide-react';
import { exportToWord, exportToPdf } from '@/lib/exportAnalysis';

function FieldWithAiIndicator({ label, value, onChange, required, multiline }: {
  label: string; value: string; onChange: (v: string) => void; required?: boolean; multiline?: boolean;
}) {
  const hasAiValue = value && value.trim().length > 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label className="text-xs">{label}{required && ' *'}</Label>
        {hasAiValue && <span title="Preenchido pela IA"><Bot className="w-3 h-3 text-primary" /></span>}
      </div>
      {multiline ? (
        <Textarea value={value} onChange={e => onChange(e.target.value)} className="text-sm" rows={3} />
      ) : (
        <Input value={value} onChange={e => onChange(e.target.value)} className="text-sm h-9" />
      )}
    </div>
  );
}

export default function AnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: analysis, isLoading } = useQuery({
    queryKey: ['analysis', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('analyses')
        .select('*, property:properties(denomination, client:clients(name))')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [formData, setFormData] = useState<any>(null);

  // Initialize form when data loads
  if (analysis && !formData) {
    const ed = (analysis.extracted_data as any) ?? {};
    setFormData(ed);
  }

  const updateField = (path: string, value: any) => {
    setFormData((prev: any) => {
      const copy = { ...prev };
      const keys = path.split('.');
      let obj = copy;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]]) obj[keys[i]] = {};
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return copy;
    });
  };

  const getField = (path: string): string => {
    if (!formData) return '';
    const keys = path.split('.');
    let obj = formData;
    for (const k of keys) {
      if (!obj) return '';
      obj = obj[k];
    }
    return obj ?? '';
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('analyses')
        .update({ extracted_data: formData })
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analysis', id] });
      toast({ title: 'Análise salva!' });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const alerts = (analysis?.alerts as any[]) ?? [];

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Carregando...</div>;
  if (!analysis) return <div className="text-center py-12 text-muted-foreground">Análise não encontrada</div>;

  const severityIcon = (s: string) => {
    if (s === 'critical') return <AlertCircle className="w-4 h-4 text-destructive" />;
    if (s === 'warning') return <AlertTriangle className="w-4 h-4 text-warning" />;
    return <Info className="w-4 h-4 text-info" />;
  };

  const severityClass = (s: string) => {
    if (s === 'critical') return 'status-badge-critical';
    if (s === 'warning') return 'status-badge-warning';
    return 'status-badge-info';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/history"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
          <div>
            <h1 className="text-2xl font-heading font-bold">
              {(analysis as any).property?.denomination ?? 'Análise'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {(analysis as any).property?.client?.name} · Versão {analysis.version}
            </p>
          </div>
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          <Save className="w-4 h-4 mr-2" />
          {saveMutation.isPending ? 'Salvando...' : 'Salvar Análise'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main form */}
        <div className="lg:col-span-3">
          <Tabs defaultValue="identification">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="identification">Identificação</TabsTrigger>
              <TabsTrigger value="owners">Proprietários</TabsTrigger>
              <TabsTrigger value="encumbrances">Ônus</TabsTrigger>
              <TabsTrigger value="boundaries">Confrontantes</TabsTrigger>
              <TabsTrigger value="transfers">Transmissões</TabsTrigger>
            </TabsList>

            <TabsContent value="identification">
              <Card>
                <CardContent className="p-5 grid grid-cols-2 gap-4">
                  <FieldWithAiIndicator label="Denominação do imóvel" value={getField('identification.denomination')} onChange={v => updateField('identification.denomination', v)} required />
                  <FieldWithAiIndicator label="Nº da matrícula" value={getField('identification.registration_number')} onChange={v => updateField('identification.registration_number', v)} required />
                  <FieldWithAiIndicator label="CCIR atual" value={getField('identification.ccir')} onChange={v => updateField('identification.ccir', v)} />
                  <FieldWithAiIndicator label="Área total (ha)" value={getField('identification.total_area')} onChange={v => updateField('identification.total_area', v)} required />
                  <FieldWithAiIndicator label="Município" value={getField('identification.municipality')} onChange={v => updateField('identification.municipality', v)} required />
                  <FieldWithAiIndicator label="UF" value={getField('identification.state')} onChange={v => updateField('identification.state', v)} required />
                  <FieldWithAiIndicator label="Comarca" value={getField('identification.county')} onChange={v => updateField('identification.county', v)} />
                  <FieldWithAiIndicator label="Cartório" value={getField('identification.registry_office')} onChange={v => updateField('identification.registry_office', v)} />
                  <FieldWithAiIndicator label="Fração ideal" value={getField('identification.ideal_fraction')} onChange={v => updateField('identification.ideal_fraction', v)} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="owners">
              <Card>
                <CardHeader><CardTitle className="text-base">Proprietários</CardTitle></CardHeader>
                <CardContent className="space-y-6">
                  {(formData?.owners ?? [{}]).map((_: any, i: number) => (
                    <div key={i} className="p-4 border border-border rounded-lg space-y-3">
                      <p className="text-sm font-semibold text-primary">Proprietário {i + 1}</p>
                      <div className="grid grid-cols-2 gap-3">
                        <FieldWithAiIndicator label="Nome completo" value={getField(`owners.${i}.name`)} onChange={v => {
                          const owners = [...(formData?.owners ?? [{}])];
                          owners[i] = { ...owners[i], name: v };
                          updateField('owners', owners);
                        }} required />
                        <FieldWithAiIndicator label="CPF/CNPJ" value={getField(`owners.${i}.cpf_cnpj`)} onChange={v => {
                          const owners = [...(formData?.owners ?? [{}])];
                          owners[i] = { ...owners[i], cpf_cnpj: v };
                          updateField('owners', owners);
                        }} required />
                        <FieldWithAiIndicator label="RG" value={getField(`owners.${i}.rg`)} onChange={v => {
                          const owners = [...(formData?.owners ?? [{}])];
                          owners[i] = { ...owners[i], rg: v };
                          updateField('owners', owners);
                        }} />
                        <FieldWithAiIndicator label="Estado civil" value={getField(`owners.${i}.marital_status`)} onChange={v => {
                          const owners = [...(formData?.owners ?? [{}])];
                          owners[i] = { ...owners[i], marital_status: v };
                          updateField('owners', owners);
                        }} />
                        <FieldWithAiIndicator label="Participação (%)" value={getField(`owners.${i}.share_percentage`)} onChange={v => {
                          const owners = [...(formData?.owners ?? [{}])];
                          owners[i] = { ...owners[i], share_percentage: v };
                          updateField('owners', owners);
                        }} />
                        <FieldWithAiIndicator label="Nacionalidade" value={getField(`owners.${i}.nationality`)} onChange={v => {
                          const owners = [...(formData?.owners ?? [{}])];
                          owners[i] = { ...owners[i], nationality: v };
                          updateField('owners', owners);
                        }} />
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => {
                    const owners = [...(formData?.owners ?? [])];
                    owners.push({});
                    updateField('owners', owners);
                  }}>Adicionar Proprietário</Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="encumbrances">
              <Card>
                <CardContent className="p-5 space-y-4">
                  <FieldWithAiIndicator label="Alienação Fiduciária" value={getField('encumbrances.fiduciary_alienation')} onChange={v => updateField('encumbrances.fiduciary_alienation', v)} multiline />
                  <FieldWithAiIndicator label="Penhora" value={getField('encumbrances.seizure')} onChange={v => updateField('encumbrances.seizure', v)} multiline />
                  <FieldWithAiIndicator label="Hipoteca" value={getField('encumbrances.mortgage')} onChange={v => updateField('encumbrances.mortgage', v)} multiline />
                  <FieldWithAiIndicator label="Servidões" value={getField('encumbrances.easements')} onChange={v => updateField('encumbrances.easements', v)} multiline />
                  <FieldWithAiIndicator label="Reserva Legal Averbada (ARL)" value={getField('encumbrances.legal_reserve')} onChange={v => updateField('encumbrances.legal_reserve', v)} multiline />
                  <FieldWithAiIndicator label="APP (Área de Preservação Permanente)" value={getField('encumbrances.app')} onChange={v => updateField('encumbrances.app', v)} multiline />
                  <FieldWithAiIndicator label="Outras cláusulas especiais" value={getField('encumbrances.special_clauses')} onChange={v => updateField('encumbrances.special_clauses', v)} multiline />
                  <FieldWithAiIndicator label="Observações gerais" value={getField('encumbrances.general_notes')} onChange={v => updateField('encumbrances.general_notes', v)} multiline />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="boundaries">
              <Card>
                <CardContent className="p-5 grid grid-cols-2 gap-4">
                  <FieldWithAiIndicator label="Norte" value={getField('boundaries.north')} onChange={v => updateField('boundaries.north', v)} multiline />
                  <FieldWithAiIndicator label="Sul" value={getField('boundaries.south')} onChange={v => updateField('boundaries.south', v)} multiline />
                  <FieldWithAiIndicator label="Leste" value={getField('boundaries.east')} onChange={v => updateField('boundaries.east', v)} multiline />
                  <FieldWithAiIndicator label="Oeste" value={getField('boundaries.west')} onChange={v => updateField('boundaries.west', v)} multiline />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="transfers">
              <Card>
                <CardHeader><CardTitle className="text-base">Últimas Transmissões</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {(formData?.transfers ?? [{}]).map((_: any, i: number) => (
                    <div key={i} className="p-4 border border-border rounded-lg space-y-3">
                      <p className="text-sm font-semibold text-primary">Transmissão {i + 1}</p>
                      <div className="grid grid-cols-2 gap-3">
                        <FieldWithAiIndicator label="Data" value={getField(`transfers.${i}.date`)} onChange={v => {
                          const transfers = [...(formData?.transfers ?? [{}])];
                          transfers[i] = { ...transfers[i], date: v };
                          updateField('transfers', transfers);
                        }} />
                        <FieldWithAiIndicator label="Natureza do ato" value={getField(`transfers.${i}.nature`)} onChange={v => {
                          const transfers = [...(formData?.transfers ?? [{}])];
                          transfers[i] = { ...transfers[i], nature: v };
                          updateField('transfers', transfers);
                        }} />
                        <FieldWithAiIndicator label="Vendedor" value={getField(`transfers.${i}.seller`)} onChange={v => {
                          const transfers = [...(formData?.transfers ?? [{}])];
                          transfers[i] = { ...transfers[i], seller: v };
                          updateField('transfers', transfers);
                        }} />
                        <FieldWithAiIndicator label="Comprador" value={getField(`transfers.${i}.buyer`)} onChange={v => {
                          const transfers = [...(formData?.transfers ?? [{}])];
                          transfers[i] = { ...transfers[i], buyer: v };
                          updateField('transfers', transfers);
                        }} />
                        <FieldWithAiIndicator label="Valor" value={getField(`transfers.${i}.value`)} onChange={v => {
                          const transfers = [...(formData?.transfers ?? [{}])];
                          transfers[i] = { ...transfers[i], value: v };
                          updateField('transfers', transfers);
                        }} />
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => {
                    const transfers = [...(formData?.transfers ?? [])];
                    transfers.push({});
                    updateField('transfers', transfers);
                  }}>Adicionar Transmissão</Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Alerts sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Alertas ({alerts.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {alerts.length > 0 ? alerts.map((alert: any, i: number) => (
                <div key={i} className={`p-3 rounded-lg text-xs ${severityClass(alert.severity)}`}>
                  <div className="flex items-start gap-2">
                    {severityIcon(alert.severity)}
                    <p>{alert.message}</p>
                  </div>
                </div>
              )) : (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhum alerta</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
