// SIGEF — integração com FeatureServer público do INCRA hospedado na ArcGIS Online.
// Endpoint público com CORS aberto (Access-Control-Allow-Origin: *), sem necessidade
// de proxy. Documentação implícita via /FeatureServer/0?f=pjson.
//
// Diferença para o SICAR:
//   - SICAR: cadastro AMBIENTAL declaratório (todo imóvel rural)
//   - SIGEF: parcelas com georreferenciamento CERTIFICADO pelo INCRA (matrícula registrada)
// Os dois cadastros são complementares. Um confrontante pode estar nos dois, em apenas
// um, ou em nenhum.

export const SIGEF_ENDPOINT =
  'https://services7.arcgis.com/QJXMUxZGStbh5qh9/ArcGIS/rest/services/INCRA_SIGEF_Imoveis_Certificados/FeatureServer/0';

export interface SigefFeature {
  codigo_parcela: string;
  nome_area: string;
  situacao: string;
  codigo_imovel: string | null;
  matricula: string | null;
  responsavel_tecnico: string | null;
  numero_art: string | null;
  municipio: string;
  uf: string;
  area_ha: number; // calculada via Shape__Area (graus²) → conversão aproximada não confiável; preferimos vazio
}

/**
 * Faz query no FeatureServer por bounding box (EPSG:4326) e devolve GeoJSON.
 * Limita a `maxRecords` features pra evitar payloads gigantes — o usuário
 * deve aproximar o zoom pra ver mais detalhes em áreas densas.
 */
export async function fetchSigefByBBox(
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
  maxRecords = 200,
): Promise<GeoJSON.FeatureCollection | null> {
  // ArcGIS REST espera geometry como envelope serializado em JSON.
  const envelope = {
    xmin: minLng,
    ymin: minLat,
    xmax: maxLng,
    ymax: maxLat,
    spatialReference: { wkid: 4326 },
  };
  const params = new URLSearchParams({
    f: 'geojson',
    where: '1=1',
    geometry: JSON.stringify(envelope),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: [
      'CodigoParcelaSIGEF',
      'NomeArea',
      'SituacaoParcela',
      'CodigoImovel',
      'RegistroMatricula',
      'ResponsavelTecnico',
      'NumeroART',
      'Município',
      'UF',
    ].join(','),
    resultRecordCount: String(maxRecords),
    returnGeometry: 'true',
  });

  try {
    // Timeout client-side: ArcGIS responde rápido (<3s) — se passar de 15s algo está errado.
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(`${SIGEF_ENDPOINT}/query?${params.toString()}`, {
      signal: ctrl.signal,
    });
    clearTimeout(timeoutId);
    if (!resp.ok) return null;
    return (await resp.json()) as GeoJSON.FeatureCollection;
  } catch {
    return null;
  }
}

/** Extrai propriedades padronizadas de uma feature SIGEF. */
export function parseSigefProperties(props: Record<string, unknown>): SigefFeature {
  return {
    codigo_parcela: String(props.CodigoParcelaSIGEF ?? ''),
    nome_area: String(props.NomeArea ?? ''),
    situacao: String(props.SituacaoParcela ?? props.Status ?? ''),
    codigo_imovel: props.CodigoImovel ? String(props.CodigoImovel) : null,
    matricula: props.RegistroMatricula ? String(props.RegistroMatricula) : null,
    responsavel_tecnico: props.ResponsavelTecnico ? String(props.ResponsavelTecnico) : null,
    numero_art: props.NumeroART ? String(props.NumeroART) : null,
    municipio: String(props.Município ?? props.Municipio ?? ''),
    uf: String(props.UF ?? ''),
    area_ha: 0,
  };
}
