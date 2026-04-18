import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import PropertyMap from '@/components/map/PropertyMap';
import { exportNeighborsToExcel } from '@/lib/exportNeighbors';
import { Plus, Trash2, FileSpreadsheet, MousePointerClick, MapPin, Edit, FileText, Loader2, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

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
const MARITAL = ['solteiro', 'casado', 'divorciado', 'viuvo', 'uniao_estavel'];
const REGIMES = ['comunhao_parcial', 'comunhao_universal', 'separacao_total', 'separacao_obrigatoria', 'participacao_aquestos'];

interface MiniForm {
  full_name: string;
  cpf_cnpj: string;
  rg: string;
  rg_issuer: string;
  marital_status: string;
  marriage_regime: string;
  spouse_name: string;
  spouse_cpf: string;
  spouse_rg: string;
  registration_number: string;
  ccir_number: string;
  phone: string;
  positions: string[];
  car_number: string;
  registry_office: string;
  property_denomination: string;
  extracted_data: any;
}

const emptyMini = (): MiniForm => ({
  full_name: '',
  cpf_cnpj: '',
  rg: '',
  rg_issuer: '',
  marital_status: '',
  marriage_regime: '',
  spouse_name: '',
  spouse_cpf: '',
  spouse_rg: '',
  registration_number: '',
  ccir_number: '',
  phone: '',
  positions: [],
  car_number: '',
  registry_office: '',
  property_denomination: '',
  extracted_data: {},
});

/** Mapeia regime textual livre da IA para o enum do formulário. */
function mapRegime(raw?: string | null): string {
  if (!raw) return '';
  const s = raw.toLowerCase();
  if (s.includes('parcial')) return 'comunhao_parcial';
  if (s.includes('universal')) return 'comunhao_universal';
  if (s.includes('obrigat')) return 'separacao_obrigatoria';
  if (s.includes('separa')) return 'separacao_total';
  if (s.includes('aquesto') || s.includes('participa')) return 'participacao_aquestos';
  // legado: "comunhão de bens, anterior à Lei 6.515/77" => comunhão universal era padrão
  if (s.includes('comunh')) return 'comunhao_universal';
  return '';
}

function mapMaritalStatus(raw?: string | null): string {
  if (!raw) return '';
  const s = raw.toLowerCase();
  if (s.startsWith('cas')) return 'casado';
  if (s.startsWith('solt')) return 'solteiro';
  if (s.startsWith('divorc')) return 'divorciado';
  if (s.startsWith('viuv') || s.startsWith('viúv')) return 'viuvo';
  if (s.includes('uni') && s.includes('est')) return 'uniao_estavel';
  return '';
}

export default function NeighborsList({ processId, clientName, processNumber, carNumber }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MiniForm>(emptyMini());
  const [showMap, setShowMap] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
        cpf_cnpj: form.cpf_cnpj || null,
        rg: form.rg || null,
        rg_issuer: form.rg_issuer || null,
        marital_status: form.marital_status || null,
        marriage_regime: form.marriage_regime || null,
        spouse_name: form.spouse_name || null,
        spouse_cpf: form.spouse_cpf || null,
        spouse_rg: form.spouse_rg || null,
        registration_number: form.registration_number || null,
        ccir_number: form.ccir_number || null,
        phones: phones as any,
        positions: form.positions,
        car_number: form.car_number || null,
        registry_office: form.registry_office || null,
        property_denomination: form.property_denomination || null,
        extracted_data: form.extracted_data ?? {},
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
      cpf_cnpj: n.cpf_cnpj ?? '',
      rg: n.rg ?? '',
      rg_issuer: n.rg_issuer ?? '',
      marital_status: n.marital_status ?? '',
      marriage_regime: n.marriage_regime ?? '',
      spouse_name: n.spouse_name ?? '',
      spouse_cpf: n.spouse_cpf ?? '',
      spouse_rg: n.spouse_rg ?? '',
      registration_number: n.registration_number ?? '',
      ccir_number: n.ccir_number ?? '',
      phone: n.phones?.[0]?.number ?? '',
      positions: n.positions ?? [],
      car_number: n.car_number ?? '',
      registry_office: n.registry_office ?? '',
      property_denomination: n.property_denomination ?? '',
      extracted_data: n.extracted_data ?? {},
    });
    setOpen(true);
  };

  const openFromMap = (info: { car: string; area: number; municipio: string; uf: string }) => {
    setEditingId(null);
    setForm({
      ...emptyMini(),
      car_number: info.car,
      property_denomination: `Imóvel rural — ${info.municipio}/${info.uf} (${info.area.toFixed(2)} ha)`,
    });
    setOpen(true);
  };

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

  /**
   * Faz upload do PDF da matrícula do confrontante e roda a IA.
   * Se houver `editingId`, persiste imediatamente no registro de process_neighbors
   * para que a aba Confrontantes reflita os dados sem precisar clicar em "Salvar".
   */
  const analyzeMatricula = async (file: File) => {
    if (!user) return;
    setAnalyzing(true);
    try {
      const filePath = `${user.id}/neighbor_${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from('matriculas').upload(filePath, file);
      if (upErr) throw upErr;

      const { data, error } = await supabase.functions.invoke('analyze-neighbor-matricula', {
        body: { pdfPath: filePath },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const owner = (data?.proprietarios_atuais ?? [])[0] ?? {};
      const analyzedAt = new Date().toISOString();
      const mergedExtracted = { ...(form.extracted_data ?? {}), ...data, _analyzed_at: analyzedAt, _pdf_path: filePath };

      const next: MiniForm = {
        ...form,
        full_name: owner.nome || form.full_name,
        cpf_cnpj: owner.cpf || form.cpf_cnpj,
        rg: owner.rg || form.rg,
        rg_issuer: owner.rg_orgao || form.rg_issuer,
        marital_status: mapMaritalStatus(owner.estado_civil) || form.marital_status,
        marriage_regime: mapRegime(owner.regime_casamento) || form.marriage_regime,
        spouse_name: owner.conjuge_nome || form.spouse_name,
        spouse_cpf: owner.conjuge_cpf || form.spouse_cpf,
        registration_number: data?.matricula_numero || form.registration_number,
        ccir_number: data?.ccir || form.ccir_number,
        registry_office: data?.cartorio || form.registry_office,
        property_denomination: data?.denominacao_imovel || form.property_denomination,
        extracted_data: mergedExtracted,
      };
      setForm(next);

      // ITEM 2: persistir imediatamente quando estiver editando registro existente.
      // Garante que a aba Confrontantes reflita os dados sem precisar clicar em "Salvar".
      if (editingId) {
        const phones = next.phone.trim() ? [{ number: next.phone.trim(), whatsapp: true }] : [];
        const dbPayload: any = {
          full_name: next.full_name || null,
          cpf_cnpj: next.cpf_cnpj || null,
          rg: next.rg || null,
          rg_issuer: next.rg_issuer || null,
          marital_status: next.marital_status || null,
          marriage_regime: next.marriage_regime || null,
          spouse_name: next.spouse_name || null,
          spouse_cpf: next.spouse_cpf || null,
          registration_number: next.registration_number || null,
          ccir_number: next.ccir_number || null,
          registry_office: next.registry_office || null,
          property_denomination: next.property_denomination || null,
          extracted_data: mergedExtracted,
        };
        if (phones.length) dbPayload.phones = phones;
        const { error: upErr2 } = await supabase.from('process_neighbors').update(dbPayload).eq('id', editingId);
        if (upErr2) throw upErr2;
        qc.invalidateQueries({ queryKey: ['neighbors', processId] });
      }

      const ownersFound = (data?.proprietarios_atuais ?? []).length;
      toast({
        title: 'Matrícula analisada',
        description: `${ownersFound} proprietário(s) extraído(s).${editingId ? ' Dados sincronizados com a aba Confrontantes.' : ' Revise e salve.'}`,
      });
    } catch (e: any) {
      toast({ title: 'Erro na análise', description: e.message, variant: 'destructive' });
    } finally {
      setAnalyzing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
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

  const showSpouse = form.marital_status === 'casado';

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
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingId ? 'Editar confrontante' : 'Novo confrontante'}</DialogTitle>
              </DialogHeader>

              {/* Aviso quando o confrontante veio do SICAR e ainda não tem dados extraídos */}
              {editingId && form.car_number && !form.full_name && !form.cpf_cnpj && (
                <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
                  <div className="text-xs">
                    <p className="font-medium text-warning-foreground">Dados pendentes</p>
                    <p className="text-muted-foreground">
                      Este confrontante foi detectado pelo SICAR (apenas polígono e CAR). Faça upload da matrícula abaixo para que a IA extraia proprietário, regime de casamento, CCIR, cônjuge e demais dados.
                    </p>
                  </div>
                </div>
              )}

              {/* Botão de análise por IA — extrai todos os dados do PDF da matrícula */}
              <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-primary" /> Análise automática da matrícula
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Faça upload do PDF da matrícula do confrontante — a IA preenche proprietário, CPF/RG, estado civil, regime, CCIR, cartório, denominação e mais.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={analyzing}
                  >
                    {analyzing ? (
                      <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Analisando…</>
                    ) : (
                      <><FileText className="w-4 h-4 mr-1.5" />Analisar PDF</>
                    )}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={e => e.target.files?.[0] && analyzeMatricula(e.target.files[0])}
                  />
                </div>
              </div>

              <div className="space-y-3 pt-1">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Nome do proprietário</Label>
                    <Input
                      value={form.full_name}
                      onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">CPF / CNPJ</Label>
                    <Input
                      value={form.cpf_cnpj}
                      onChange={e => setForm(f => ({ ...f, cpf_cnpj: e.target.value }))}
                      className="mt-1.5"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">RG</Label>
                    <Input value={form.rg} onChange={e => setForm(f => ({ ...f, rg: e.target.value }))} className="mt-1.5" />
                  </div>
                  <div>
                    <Label className="text-xs">Órgão emissor</Label>
                    <Input value={form.rg_issuer} onChange={e => setForm(f => ({ ...f, rg_issuer: e.target.value }))} className="mt-1.5" />
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

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Estado civil</Label>
                    <Select value={form.marital_status} onValueChange={v => setForm(f => ({ ...f, marital_status: v }))}>
                      <SelectTrigger className="mt-1.5"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        {MARITAL.map(m => <SelectItem key={m} value={m}>{m.replace('_', ' ')}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {showSpouse && (
                    <div>
                      <Label className="text-xs">Regime de bens</Label>
                      <Select value={form.marriage_regime} onValueChange={v => setForm(f => ({ ...f, marriage_regime: v }))}>
                        <SelectTrigger className="mt-1.5"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {REGIMES.map(r => <SelectItem key={r} value={r}>{r.replace(/_/g, ' ')}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {showSpouse && (
                  <Card className="bg-muted/30">
                    <CardContent className="p-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Cônjuge</p>
                      <div className="grid grid-cols-3 gap-2">
                        <Input placeholder="Nome" value={form.spouse_name} onChange={e => setForm(f => ({ ...f, spouse_name: e.target.value }))} />
                        <Input placeholder="CPF" value={form.spouse_cpf} onChange={e => setForm(f => ({ ...f, spouse_cpf: e.target.value }))} />
                        <Input placeholder="RG" value={form.spouse_rg} onChange={e => setForm(f => ({ ...f, spouse_rg: e.target.value }))} />
                      </div>
                    </CardContent>
                  </Card>
                )}

                <div className="border-t border-border pt-3 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground">Imóvel confrontante</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Denominação</Label>
                      <Input
                        value={form.property_denomination}
                        onChange={e => setForm(f => ({ ...f, property_denomination: e.target.value }))}
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Nº matrícula</Label>
                      <Input
                        value={form.registration_number}
                        onChange={e => setForm(f => ({ ...f, registration_number: e.target.value }))}
                        className="mt-1.5"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">CAR</Label>
                      <Input
                        value={form.car_number}
                        onChange={e => setForm(f => ({ ...f, car_number: e.target.value.toUpperCase() }))}
                        className="mt-1.5 font-mono text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Cartório</Label>
                      <Input
                        value={form.registry_office}
                        onChange={e => setForm(f => ({ ...f, registry_office: e.target.value }))}
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">CCIR</Label>
                      <Input
                        value={form.ccir_number}
                        onChange={e => setForm(f => ({ ...f, ccir_number: e.target.value }))}
                        className="mt-1.5"
                      />
                    </div>
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
                <th className="text-left p-2 font-medium">CCIR</th>
                <th className="text-left p-2 font-medium">Telefone</th>
                <th className="text-left p-2 font-medium">CAR</th>
                <th className="text-right p-2 font-medium w-20">Ações</th>
              </tr>
            </thead>
            <tbody>
              {(neighbors as any[]).map(n => {
                const needsExtraction = !n.full_name && !n.cpf_cnpj && n.car_number;
                const analyzedAt = n.extracted_data?._analyzed_at as string | undefined;
                return (
                <tr key={n.id} className="border-t border-border hover:bg-muted/30">
                  <td className="p-2 text-xs">{n.positions?.join(', ') || '—'}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>{n.full_name || <span className="text-muted-foreground italic">sem nome</span>}</span>
                      {needsExtraction && (
                        <Badge variant="outline" className="border-warning/50 text-warning text-[10px] px-1.5 py-0">
                          sem matrícula
                        </Badge>
                      )}
                      {analyzedAt && (
                        <Badge
                          variant="outline"
                          className="border-success/50 text-success text-[10px] px-1.5 py-0"
                          title={`Analisada em ${new Date(analyzedAt).toLocaleString('pt-BR')}`}
                        >
                          Matrícula analisada ✓
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="p-2 text-xs">{n.registration_number || '—'}</td>
                  <td className="p-2 text-xs">{n.ccir_number || '—'}</td>
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
