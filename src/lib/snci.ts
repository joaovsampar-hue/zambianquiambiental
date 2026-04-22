// SNCI — Sistema Nacional de Certificação de Imóveis (1ª Norma, até 2013).
// Camada histórica estática — não há novas certificações neste sistema.
// Os dados são GeoJSON por UF hospedados no Supabase Storage (bucket: snci-data).
// Carregamento sob demanda com cache em memória para a sessão.

import { supabase } from '@/integrations/supabase/client';

/** Cache em memória: UF → GeoJSON já carregado nesta sessão. */
const snciCache = new Map<string, GeoJSON.FeatureCollection>();

/** Status de carregamento por UF — evita requisições paralelas duplicadas. */
const snciLoading = new Map<string, Promise<GeoJSON.FeatureCollection | null>>();

/**
 * Carrega o GeoJSON SNCI de uma UF do Supabase Storage.
 * Retorna null se o arquivo não existir ou ocorrer erro.
 */
export async function loadSnciGeoJSON(
  uf: string,
): Promise<GeoJSON.FeatureCollection | null> {
  const key = uf.toLowerCase();

  // Cache hit
  if (snciCache.has(key)) return snciCache.get(key)!;

  // Deduplicar requests paralelos para a mesma UF
  if (snciLoading.has(key)) return snciLoading.get(key)!;

  const promise = (async () => {
    try {
      const { data, error } = await supabase.storage
        .from('snci-data')
        .download(`snci_privado_${key}.geojson`);

      if (error || !data) return null;

      const text = await data.text();
      const fc = JSON.parse(text) as GeoJSON.FeatureCollection;
      snciCache.set(key, fc);
      return fc;
    } catch {
      return null;
    } finally {
      snciLoading.delete(key);
    }
  })();

  snciLoading.set(key, promise);
  return promise;
}

/** Limpa o cache de uma UF (útil para testes ou recarregamento). */
export function clearSnciCache(uf?: string) {
  if (uf) snciCache.delete(uf.toLowerCase());
  else snciCache.clear();
}
