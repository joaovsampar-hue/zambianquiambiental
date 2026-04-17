import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { Trash2, Plus, Phone } from 'lucide-react';

const POSITIONS = ['N', 'S', 'L', 'O', 'NE', 'NO', 'SE', 'SO'];
const NEIGHBOR_TYPES = [
  { k: 'pf', l: 'Pessoa Física' },
  { k: 'pj', l: 'Pessoa Jurídica' },
  { k: 'logradouro', l: 'Logradouro' },
  { k: 'rio', l: 'Rio/Córrego' },
  { k: 'reserva', l: 'Reserva/APP' },
  { k: 'outro', l: 'Outro' },
];
const MARITAL = ['solteiro', 'casado', 'divorciado', 'viuvo', 'uniao_estavel'];
const REGIMES = ['comunhao_parcial', 'comunhao_universal', 'separacao_total', 'separacao_obrigatoria', 'participacao_aquestos'];

export interface Phone { number: string; whatsapp: boolean; }

export interface NeighborFormData {
  positions: string[];
  neighbor_type: string;
  full_name: string;
  cpf_cnpj: string;
  rg: string;
  rg_issuer: string;
  birth_date: string;
  marital_status: string;
  marriage_regime: string;
  spouse_name: string;
  spouse_cpf: string;
  spouse_rg: string;
  address: string;
  phones: Phone[];
  email: string;
  car_number: string;
  registration_number: string;
  registry_office: string;
  ccir_number: string;
  property_denomination: string;
  notes: string;
}

interface Props {
  data: NeighborFormData;
  onChange: (d: NeighborFormData) => void;
}

export default function NeighborForm({ data, onChange }: Props) {
  const set = <K extends keyof NeighborFormData>(k: K, v: NeighborFormData[K]) =>
    onChange({ ...data, [k]: v });
  const togglePos = (p: string) => {
    const next = data.positions.includes(p)
      ? data.positions.filter(x => x !== p)
      : [...data.positions, p];
    set('positions', next);
  };
  const updatePhone = (i: number, patch: Partial<Phone>) => {
    const next = data.phones.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    set('phones', next);
  };
  const isPerson = data.neighbor_type === 'pf' || data.neighbor_type === 'pj';
  const showSpouse = data.neighbor_type === 'pf' && data.marital_status === 'casado';

  return (
    <div className="space-y-4">
      {/* Posição & tipo */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Posição (limite)</Label>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {POSITIONS.map(p => (
              <button
                type="button"
                key={p}
                onClick={() => togglePos(p)}
                className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                  data.positions.includes(p)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:bg-accent'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label className="text-xs">Tipo</Label>
          <Select value={data.neighbor_type} onValueChange={v => set('neighbor_type', v)}>
            <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              {NEIGHBOR_TYPES.map(t => <SelectItem key={t.k} value={t.k}>{t.l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Nome / denominação */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Nome / denominação</Label>
          <Input value={data.full_name} onChange={e => set('full_name', e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label className="text-xs">{data.neighbor_type === 'pj' ? 'CNPJ' : 'CPF'}</Label>
          <Input value={data.cpf_cnpj} onChange={e => set('cpf_cnpj', e.target.value)} className="mt-1.5" />
        </div>
      </div>

      {isPerson && data.neighbor_type === 'pf' && (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">RG</Label>
            <Input value={data.rg} onChange={e => set('rg', e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">Órgão emissor</Label>
            <Input value={data.rg_issuer} onChange={e => set('rg_issuer', e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">Data nasc.</Label>
            <Input type="date" value={data.birth_date} onChange={e => set('birth_date', e.target.value)} className="mt-1.5" />
          </div>
        </div>
      )}

      {data.neighbor_type === 'pf' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Estado civil</Label>
            <Select value={data.marital_status} onValueChange={v => set('marital_status', v)}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {MARITAL.map(m => <SelectItem key={m} value={m}>{m.replace('_', ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {showSpouse && (
            <div>
              <Label className="text-xs">Regime de bens</Label>
              <Select value={data.marriage_regime} onValueChange={v => set('marriage_regime', v)}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {REGIMES.map(r => <SelectItem key={r} value={r}>{r.replace(/_/g, ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {showSpouse && (
        <Card className="bg-muted/30">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Cônjuge</p>
            <div className="grid grid-cols-3 gap-2">
              <Input placeholder="Nome" value={data.spouse_name} onChange={e => set('spouse_name', e.target.value)} />
              <Input placeholder="CPF" value={data.spouse_cpf} onChange={e => set('spouse_cpf', e.target.value)} />
              <Input placeholder="RG" value={data.spouse_rg} onChange={e => set('spouse_rg', e.target.value)} />
            </div>
          </CardContent>
        </Card>
      )}

      <div>
        <Label className="text-xs">Endereço</Label>
        <Input value={data.address} onChange={e => set('address', e.target.value)} className="mt-1.5" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">E-mail</Label>
          <Input type="email" value={data.email} onChange={e => set('email', e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label className="text-xs">Telefones</Label>
          <div className="space-y-1.5 mt-1.5">
            {data.phones.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={p.number}
                  onChange={e => updatePhone(i, { number: e.target.value })}
                  placeholder="(00) 00000-0000"
                  className="h-8"
                />
                <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                  <Checkbox checked={p.whatsapp} onCheckedChange={c => updatePhone(i, { whatsapp: !!c })} />
                  WhatsApp
                </label>
                <button type="button" onClick={() => set('phones', data.phones.filter((_, x) => x !== i))}>
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            ))}
            <Button
              type="button" variant="outline" size="sm"
              onClick={() => set('phones', [...data.phones, { number: '', whatsapp: true }])}
            >
              <Plus className="w-3 h-3 mr-1" /> Adicionar telefone
            </Button>
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-3 space-y-3">
        <p className="text-xs font-medium text-muted-foreground">Imóvel confrontante</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Denominação</Label>
            <Input value={data.property_denomination} onChange={e => set('property_denomination', e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">Nº matrícula</Label>
            <Input value={data.registration_number} onChange={e => set('registration_number', e.target.value)} className="mt-1.5" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">CAR</Label>
            <Input value={data.car_number} onChange={e => set('car_number', e.target.value.toUpperCase())} className="mt-1.5 font-mono text-xs" />
          </div>
          <div>
            <Label className="text-xs">Cartório</Label>
            <Input value={data.registry_office} onChange={e => set('registry_office', e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">CCIR</Label>
            <Input value={data.ccir_number} onChange={e => set('ccir_number', e.target.value)} className="mt-1.5" />
          </div>
        </div>
      </div>

      <div>
        <Label className="text-xs">Observações</Label>
        <Textarea value={data.notes} onChange={e => set('notes', e.target.value)} rows={2} className="mt-1.5" />
      </div>
    </div>
  );
}

export const emptyNeighbor = (): NeighborFormData => ({
  positions: [], neighbor_type: 'pf', full_name: '', cpf_cnpj: '', rg: '', rg_issuer: '',
  birth_date: '', marital_status: '', marriage_regime: '',
  spouse_name: '', spouse_cpf: '', spouse_rg: '',
  address: '', phones: [], email: '',
  car_number: '', registration_number: '', registry_office: '', ccir_number: '',
  property_denomination: '', notes: '',
});
