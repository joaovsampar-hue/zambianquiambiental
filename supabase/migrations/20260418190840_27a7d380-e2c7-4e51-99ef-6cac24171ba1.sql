-- 1. Adicionar campos de RT e elaborador no perfil do usuário
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role_title TEXT,
  ADD COLUMN IF NOT EXISTS registry_type TEXT,
  ADD COLUMN IF NOT EXISTS registry_number TEXT,
  ADD COLUMN IF NOT EXISTS signature_path TEXT,
  ADD COLUMN IF NOT EXISTS is_responsible_technician BOOLEAN NOT NULL DEFAULT false;

-- 2. Tabela de configurações da empresa (singleton por equipe — uma linha apenas)
CREATE TABLE IF NOT EXISTS public.company_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'GeoConfront',
  tagline TEXT DEFAULT 'Análise de Confrontantes',
  logo_path TEXT,
  default_responsible_user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view company settings"
  ON public.company_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert company settings"
  ON public.company_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update company settings"
  ON public.company_settings FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_company_settings_updated_at
  BEFORE UPDATE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Bucket público para logos e assinaturas (acesso de leitura aberto, upload restrito)
INSERT INTO storage.buckets (id, name, public)
  VALUES ('company-assets', 'company-assets', true)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read company assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'company-assets');

CREATE POLICY "Authenticated upload company assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-assets');

CREATE POLICY "Authenticated update company assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'company-assets');

CREATE POLICY "Authenticated delete company assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'company-assets');
