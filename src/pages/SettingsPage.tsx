import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import Breadcrumb from '@/components/Breadcrumb';
import { Building2, Upload, Loader2, Image as ImageIcon } from 'lucide-react';
import { fetchCompanySettings, publicUrl, type CompanySettings } from '@/lib/companyMetadata';

const BUCKET = 'company-assets';

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('GeoConfront');
  const [tagline, setTagline] = useState('Análise de Confrontantes');
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [defaultRt, setDefaultRt] = useState<string>('__none__');
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['company-settings'],
    queryFn: fetchCompanySettings,
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles-rt'],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('user_id, full_name, email, is_responsible_technician')
        .eq('is_responsible_technician', true);
      return data ?? [];
    },
  });

  useEffect(() => {
    if (settings) {
      setName(settings.name);
      setTagline(settings.tagline ?? '');
      setLogoPath(settings.logo_path);
      setDefaultRt(settings.default_responsible_user_id ?? '__none__');
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        tagline: tagline || null,
        logo_path: logoPath,
        default_responsible_user_id: defaultRt === '__none__' ? null : defaultRt,
      };
      if (settings?.id) {
        const { error } = await supabase.from('company_settings').update(payload).eq('id', settings.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('company_settings').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: 'Configurações salvas' });
      qc.invalidateQueries({ queryKey: ['company-settings'] });
    },
    onError: (err: any) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  });

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploadingLogo(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `logos/${user.id}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      setLogoPath(path);
      toast({ title: 'Logo enviada', description: 'Clique em Salvar para aplicar.' });
    } catch (err: any) {
      toast({ title: 'Falha no upload', description: err.message, variant: 'destructive' });
    } finally {
      setUploadingLogo(false);
    }
  };

  if (isLoading) return <div className="text-muted-foreground">Carregando...</div>;

  const logoUrl = publicUrl(logoPath);

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <Breadcrumb items={[{ label: 'Configurações' }]} />
      <div>
        <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
          <Building2 className="w-6 h-6 text-primary" />
          Configurações da Empresa
        </h1>
        <p className="text-sm text-muted-foreground">
          Estes dados aparecem no cabeçalho dos PDFs exportados (mapa, relatórios) para toda a equipe.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identificação</CardTitle>
          <CardDescription>Nome e logotipo que serão impressos no PDF.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome da empresa</Label>
              <Input value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Subtítulo / atividade</Label>
              <Input value={tagline} onChange={e => setTagline(e.target.value)} placeholder="Ex.: Geo Análise Ambiental" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Logotipo (PNG transparente recomendado)</Label>
            <div className="flex items-center gap-4">
              <div className="w-28 h-20 rounded-lg border border-dashed border-border flex items-center justify-center bg-muted/40 overflow-hidden">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" className="max-w-full max-h-full object-contain" />
                ) : (
                  <ImageIcon className="w-8 h-8 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 space-y-2">
                <Input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoUpload} disabled={uploadingLogo} />
                {uploadingLogo && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" /> Enviando...
                  </p>
                )}
                {logoPath && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setLogoPath(null)}>
                    Remover logo
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Responsável Técnico padrão</CardTitle>
          <CardDescription>
            Quando definido, este profissional aparecerá automaticamente como RT no rodapé dos PDFs.
            Se vazio, cada usuário será listado como RT em seus próprios PDFs (caso esteja marcado como RT no perfil).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label>RT padrão da equipe</Label>
          <Select value={defaultRt} onValueChange={setDefaultRt}>
            <SelectTrigger><SelectValue placeholder="Sem RT padrão" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Sem RT padrão —</SelectItem>
              {profiles.map((p: any) => (
                <SelectItem key={p.user_id} value={p.user_id}>{p.full_name || p.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Apenas usuários marcados como "Responsável Técnico" no perfil aparecem aqui.
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Salvando...</> : <><Upload className="w-4 h-4 mr-1.5" /> Salvar configurações</>}
        </Button>
      </div>
    </div>
  );
}
