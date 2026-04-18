import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus, MapPin, FileSearch, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DeleteButton from '@/components/DeleteButton';

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ denomination: '', registration_number: '', municipality: '', state: '', total_area_ha: '' });

  const deleteProperty = useMutation({
    mutationFn: async (propertyId: string) => {
      await supabase.from('analyses').delete().eq('property_id', propertyId);
      const { error } = await supabase.from('properties').delete().eq('id', propertyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['properties', id] });
      toast({ title: 'Imóvel excluído' });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const deleteClient = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('clients').delete().eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast({ title: 'Cliente excluído' });
      navigate('/clients');
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const { data: client } = useQuery({
    queryKey: ['client', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').eq('id', id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: properties } = useQuery({
    queryKey: ['properties', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('properties').select('*, analyses(id, status, version)').eq('client_id', id!).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createProperty = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('properties').insert({
        ...form,
        total_area_ha: form.total_area_ha ? parseFloat(form.total_area_ha) : null,
        client_id: id!,
        created_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['properties', id] });
      setOpen(false);
      setForm({ denomination: '', registration_number: '', municipality: '', state: '', total_area_ha: '' });
      toast({ title: 'Imóvel cadastrado!' });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  if (!client) return <div className="text-center py-12 text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/clients"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
          <div>
            <h1 className="text-2xl font-heading font-bold">{client.name}</h1>
            <p className="text-muted-foreground text-sm">{client.cpf_cnpj} · {client.email}</p>
          </div>
        </div>
        <DeleteButton
          variant="outline"
          label="Excluir cliente"
          title="Excluir cliente?"
          description={`O cliente "${client.name}" e todos os imóveis e análises vinculados serão removidos.`}
          onConfirm={async () => { await deleteClient.mutateAsync(); }}
          stopPropagation={false}
        />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-heading font-semibold">Imóveis</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="w-4 h-4 mr-1" />Novo Imóvel</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo Imóvel</DialogTitle></DialogHeader>
            <form onSubmit={e => { e.preventDefault(); createProperty.mutate(); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Denominação *</Label>
                <Input value={form.denomination} onChange={e => setForm(p => ({ ...p, denomination: e.target.value }))} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Nº Matrícula</Label>
                  <Input value={form.registration_number} onChange={e => setForm(p => ({ ...p, registration_number: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Área (ha)</Label>
                  <Input type="number" step="0.01" value={form.total_area_ha} onChange={e => setForm(p => ({ ...p, total_area_ha: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Município</Label>
                  <Input value={form.municipality} onChange={e => setForm(p => ({ ...p, municipality: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>UF</Label>
                  <Input value={form.state} onChange={e => setForm(p => ({ ...p, state: e.target.value }))} maxLength={2} />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={createProperty.isPending}>
                {createProperty.isPending ? 'Salvando...' : 'Cadastrar'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {properties && properties.length > 0 ? (
        <div className="grid gap-3">
          {properties.map((p: any) => (
            <Link key={p.id} to={`/properties/${p.id}`}>
              <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-info/10 flex items-center justify-center">
                      <MapPin className="w-5 h-5 text-info" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{p.denomination}</p>
                      <p className="text-xs text-muted-foreground">
                        Mat. {p.registration_number || '—'} · {p.municipality}/{p.state} · {p.total_area_ha ?? '—'} ha
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{p.analyses?.length ?? 0} análises</span>
                    <DeleteButton
                      iconOnly
                      title="Excluir imóvel?"
                      description={`O imóvel "${p.denomination}" e suas análises serão removidos.`}
                      onConfirm={async () => { await deleteProperty.mutateAsync(p.id); }}
                    />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <MapPin className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Nenhum imóvel cadastrado</p>
        </div>
      )}
    </div>
  );
}
