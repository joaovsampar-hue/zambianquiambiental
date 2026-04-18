import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import Breadcrumb from '@/components/Breadcrumb';
import { UserCog, Loader2, Image as ImageIcon } from 'lucide-react';
import { fetchProfile, publicUrl } from '@/lib/companyMetadata';

const BUCKET = 'company-assets';
const REGISTRY_TYPES = ['CREA', 'CFT', 'CRBio', 'OAB', 'Outro'];

export default function ProfilePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [fullName, setFullName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [registryType, setRegistryType] = useState<string>('CREA');
  const [registryNumber, setRegistryNumber] = useState('');
  const [signaturePath, setSignaturePath] = useState<string | null>(null);
  const [isRT, setIsRT] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile', user?.id],
    enabled: !!user,
    queryFn: () => fetchProfile(user!.id),
  });

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '');
      setRoleTitle(profile.role_title || '');
      setRegistryType(profile.registry_type || 'CREA');
      setRegistryNumber(profile.registry_number || '');
      setSignaturePath(profile.signature_path);
      setIsRT(profile.is_responsible_technician);
    }
  }, [profile]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName,
          role_title: roleTitle || null,
          registry_type: isRT ? registryType : null,
          registry_number: isRT ? (registryNumber || null) : null,
          signature_path: signaturePath,
          is_responsible_technician: isRT,
        })
        .eq('user_id', user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Perfil atualizado' });
      qc.invalidateQueries({ queryKey: ['profile', user?.id] });
      qc.invalidateQueries({ queryKey: ['profiles-rt'] });
    },
    onError: (err: any) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  });

  const handleSigUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `signatures/${user.id}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      setSignaturePath(path);
      toast({ title: 'Assinatura enviada', description: 'Clique em Salvar para aplicar.' });
    } catch (err: any) {
      toast({ title: 'Falha no upload', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  if (isLoading) return <div className="text-muted-foreground">Carregando...</div>;
  const sigUrl = publicUrl(signaturePath);

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <Breadcrumb items={[{ label: 'Meu perfil' }]} />
      <div>
        <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
          <UserCog className="w-6 h-6 text-primary" />
          Meu Perfil
        </h1>
        <p className="text-sm text-muted-foreground">
          Dados profissionais usados na assinatura dos PDFs e relatórios.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identificação</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome completo</Label>
              <Input value={fullName} onChange={e => setFullName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Cargo / função</Label>
              <Input value={roleTitle} onChange={e => setRoleTitle(e.target.value)} placeholder="Ex.: Engenheiro Agrimensor" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Responsabilidade Técnica</CardTitle>
          <CardDescription>
            Marque se você é Responsável Técnico habilitado a assinar projetos. Apenas usuários marcados aparecem
            como opção de RT padrão nas Configurações da Empresa.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={isRT} onCheckedChange={setIsRT} id="rt-toggle" />
            <Label htmlFor="rt-toggle" className="cursor-pointer">Sou Responsável Técnico</Label>
          </div>

          {isRT && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Tipo de registro</Label>
                  <Select value={registryType} onValueChange={setRegistryType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {REGISTRY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Número do registro</Label>
                  <Input value={registryNumber} onChange={e => setRegistryNumber(e.target.value)} placeholder="Ex.: SP-5070123456" />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Assinatura digitalizada (PNG transparente)</Label>
                <div className="flex items-center gap-4">
                  <div className="w-40 h-20 rounded-lg border border-dashed border-border flex items-center justify-center bg-muted/40 overflow-hidden">
                    {sigUrl ? (
                      <img src={sigUrl} alt="Assinatura" className="max-w-full max-h-full object-contain" />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <Input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleSigUpload} disabled={uploading} />
                    {uploading && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" /> Enviando...
                      </p>
                    )}
                    {signaturePath && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setSignaturePath(null)}>
                        Remover assinatura
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Recomendado: PNG com fundo transparente, ~600x200 px. Aparecerá acima da linha de assinatura no PDF.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Salvando...</> : 'Salvar perfil'}
        </Button>
      </div>
    </div>
  );
}
