// SICAR — integração via Cloudflare Worker (proxy CORS + TLS).
// O Worker faz o repasse para https://geoserver.car.gov.br/geoserver/sicar/{wms,wfs}.
// Documentação dos endpoints, camadas (sicar:sicar_imoveis_{uf}) e schema (cod_imovel)
// foi obtida via GetCapabilities + DescribeFeatureType.

export const SICAR_PROXY = 'https://sicar-proxy.joaov-sampar.workers.dev';
export const SICAR_WMS = `${SICAR_PROXY}/wms`;
export const SICAR_WFS = `${SICAR_PROXY}/wfs`;

/** UFs com camada SICAR disponível no GeoServer (todas as 27 unidades). */
export const SICAR_UFS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA',
  'PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
] as const;
export type SicarUF = typeof SICAR_UFS[number];

export const sicarLayerForUF = (uf: string) => `sicar:sicar_imoveis_${uf.toLowerCase()}`;

/**
 * Extrai a UF do número do CAR.
 * Formato esperado: `UF-IBGE-HASH` (ex: SP-3500402-0023CF6564CA47AD8EA6E0BDD0ED25C2).
 * Aceita variações com/sem hífen, espaços e pontos.
 */
export function parseCarUF(car: string): SicarUF | null {
  if (!car) return null;
  const cleaned = car.trim().toUpperCase().replace(/\s+/g, '');
  const match = cleaned.match(/^([A-Z]{2})[-.]?\d/);
  if (!match) return null;
  const uf = match[1] as SicarUF;
  return SICAR_UFS.includes(uf) ? uf : null;
}

/** Normaliza o CAR para a query WFS (mantém hífens, remove espaços). */
export function sanitizeCar(car: string): string {
  return car.trim().toUpperCase().replace(/\s+/g, '');
}

export interface CarFeature {
  cod_imovel: string;
  area: number;
  municipio: string;
  uf: string;
  condicao: string | null;
  status_imovel: string;
  tipo_imovel: string;
  geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon;
}

export interface CarFetchResult {
  ok: true;
  feature: CarFeature;
  raw: GeoJSON.FeatureCollection;
}

export interface CarFetchError {
  ok: false;
  reason: 'invalid_format' | 'not_found' | 'network_error';
  message: string;
}

/**
 * Busca o polígono de um imóvel pelo número do CAR via WFS GetFeature.
 * Retorna GeoJSON pronto pra ser renderizado no Leaflet.
 */
export async function fetchCarPolygon(car: string): Promise<CarFetchResult | CarFetchError> {
  const uf = parseCarUF(car);
  if (!uf) {
    return { ok: false, reason: 'invalid_format', message: 'CAR inválido — esperado formato UF-XXXXXXX-...' };
  }
  const sanitized = sanitizeCar(car);
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: sicarLayerForUF(uf),
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    CQL_FILTER: `cod_imovel='${sanitized}'`,
    count: '1',
  });

  try {
    const resp = await fetch(`${SICAR_WFS}?${params.toString()}`);
    if (!resp.ok) {
      return { ok: false, reason: 'network_error', message: `SICAR retornou ${resp.status}` };
    }
    const json = (await resp.json()) as GeoJSON.FeatureCollection;
    const f = json.features?.[0];
    if (!f) {
      return { ok: false, reason: 'not_found', message: 'CAR não encontrado no SICAR' };
    }
    const props = f.properties as Record<string, unknown>;
    return {
      ok: true,
      raw: json,
      feature: {
        cod_imovel: String(props.cod_imovel ?? sanitized),
        area: Number(props.area ?? 0),
        municipio: String(props.municipio ?? ''),
        uf: String(props.uf ?? uf),
        condicao: (props.condicao as string) ?? null,
        status_imovel: String(props.status_imovel ?? ''),
        tipo_imovel: String(props.tipo_imovel ?? ''),
        geometry: f.geometry as GeoJSON.MultiPolygon | GeoJSON.Polygon,
      },
    };
  } catch (e) {
    return { ok: false, reason: 'network_error', message: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

/**
 * Busca todos os imóveis vizinhos dentro de um bbox expandido.
 * Útil pra exibir confrontantes potenciais ao redor do imóvel principal.
 */
export async function fetchNeighborsInBbox(
  uf: SicarUF,
  bbox: [number, number, number, number], // [minLng, minLat, maxLng, maxLat]
  excludeCar?: string,
  maxFeatures = 200,
): Promise<GeoJSON.FeatureCollection | null> {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  // WFS 2.0 + EPSG:4326 → ordem lat/lng. GeoServer aceita BBOX com srsName explícito.
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: sicarLayerForUF(uf),
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: String(maxFeatures),
    BBOX: `${minLat},${minLng},${maxLat},${maxLng},EPSG:4326`,
  });
  if (excludeCar) {
    params.set('CQL_FILTER', `cod_imovel<>'${sanitizeCar(excludeCar)}' AND BBOX(geo_area_imovel,${minLat},${minLng},${maxLat},${maxLng})`);
    params.delete('BBOX');
  }
  try {
    const resp = await fetch(`${SICAR_WFS}?${params.toString()}`);
    if (!resp.ok) return null;
    return (await resp.json()) as GeoJSON.FeatureCollection;
  } catch {
    return null;
  }
}
