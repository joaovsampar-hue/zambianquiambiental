// Helpers para buscar metadata da empresa + RT (responsável técnico) usados
// em exportações de PDF (mapa, relatórios). Centraliza a lógica para que as
// telas só precisem chamar `loadExportMetadata(currentUserId)`.

import { supabase } from '@/integrations/supabase/client';

export interface CompanySettings {
  id: string;
  name: string;
  tagline: string | null;
  logo_path: string | null;
  default_responsible_user_id: string | null;
}

export interface ProfileWithRT {
  user_id: string;
  full_name: string;
  email: string;
  role_title: string | null;
  registry_type: string | null;
  registry_number: string | null;
  signature_path: string | null;
  is_responsible_technician: boolean;
}

export interface ExportMetadata {
  companyName: string;
  companyTagline: string;
  companyLogoUrl?: string;
  responsibleName?: string;
  responsibleRole?: string;
  responsibleRegistry?: string;
  responsibleSignatureUrl?: string;
  producedBy?: string;
}

const BUCKET = 'company-assets';

export function publicUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data?.publicUrl;
}

export async function fetchCompanySettings(): Promise<CompanySettings | null> {
  const { data } = await supabase
    .from('company_settings')
    .select('id, name, tagline, logo_path, default_responsible_user_id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as CompanySettings) ?? null;
}

export async function fetchProfile(userId: string): Promise<ProfileWithRT | null> {
  const { data } = await supabase
    .from('profiles')
    .select('user_id, full_name, email, role_title, registry_type, registry_number, signature_path, is_responsible_technician')
    .eq('user_id', userId)
    .maybeSingle();
  return (data as ProfileWithRT) ?? null;
}

/**
 * Monta o pacote de metadata para exportação:
 *   - Empresa (logo, nome, tagline) — vem da única linha de company_settings.
 *   - RT — preferência: o `default_responsible_user_id` da empresa; se vazio,
 *     o próprio usuário se ele estiver marcado como `is_responsible_technician`.
 *   - Elaborador (`producedBy`) — sempre o usuário logado.
 */
export async function loadExportMetadata(currentUserId: string): Promise<ExportMetadata> {
  const [company, currentProfile] = await Promise.all([
    fetchCompanySettings(),
    fetchProfile(currentUserId),
  ]);

  const rtUserId = company?.default_responsible_user_id ?? (currentProfile?.is_responsible_technician ? currentUserId : null);
  const rtProfile = rtUserId === currentUserId ? currentProfile : (rtUserId ? await fetchProfile(rtUserId) : null);

  const registry = rtProfile?.registry_type && rtProfile?.registry_number
    ? `${rtProfile.registry_type} ${rtProfile.registry_number}`
    : (rtProfile?.registry_number ?? undefined);

  return {
    companyName: company?.name ?? 'GeoConfront',
    companyTagline: company?.tagline ?? 'Análise de Confrontantes',
    companyLogoUrl: publicUrl(company?.logo_path),
    responsibleName: rtProfile?.full_name || undefined,
    responsibleRole: rtProfile?.role_title ?? undefined,
    responsibleRegistry: registry,
    responsibleSignatureUrl: publicUrl(rtProfile?.signature_path),
    producedBy: currentProfile?.full_name || undefined,
  };
}
