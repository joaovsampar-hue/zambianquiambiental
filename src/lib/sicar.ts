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
 * Converte uma geometria GeoJSON (Polygon/MultiPolygon) para WKT.
 * Necessário para usar operadores espaciais (TOUCHES/INTERSECTS) no CQL_FILTER do GeoServer.
 */
function geometryToWkt(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): string {
  const ring = (r: GeoJSON.Position[]) =>
    '(' + r.map(([lng, lat]) => `${lng} ${lat}`).join(', ') + ')';
  const poly = (p: GeoJSON.Position[][]) => '(' + p.map(ring).join(', ') + ')';
  if (geom.type === 'Polygon') return `POLYGON ${poly(geom.coordinates)}`;
  return `MULTIPOLYGON (${geom.coordinates.map(poly).join(', ')})`;
}

/**
 * Busca apenas os imóveis que **fazem confronto direto** com a geometria informada
 * (compartilham fronteira — operador espacial TOUCHES). Não usa raio/bbox.
 * Retorna FeatureCollection pronto pra renderizar no Leaflet.
 */
export async function fetchTouchingNeighbors(
  uf: SicarUF,
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  excludeCar: string,
  maxFeatures = 100,
): Promise<GeoJSON.FeatureCollection | null> {
  const wkt = geometryToWkt(geometry);
  // TOUCHES: fronteiras se tocam mas interiores não se intersectam — confrontantes diretos.
  // Acrescentamos INTERSECTS como fallback para casos de pequenas sobreposições topológicas
  // (comuns no SICAR por imprecisão de digitalização).
  const cql = `(TOUCHES(geo_area_imovel, ${wkt}) OR INTERSECTS(geo_area_imovel, ${wkt})) AND cod_imovel<>'${sanitizeCar(excludeCar)}'`;
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: sicarLayerForUF(uf),
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: String(maxFeatures),
    CQL_FILTER: cql,
  });
  try {
    const resp = await fetch(`${SICAR_WFS}?${params.toString()}`);
    if (!resp.ok) return null;
    return (await resp.json()) as GeoJSON.FeatureCollection;
  } catch {
    return null;
  }
}

/**
 * Identifica o imóvel SICAR (se houver) que contém um ponto clicado no mapa.
 * Usa WFS GetFeature + CQL INTERSECTS — mais confiável que WMS GetFeatureInfo
 * quando se trabalha com proxy.
 */
export async function fetchFeatureAtPoint(
  uf: SicarUF,
  lat: number,
  lng: number,
): Promise<CarFeature | null> {
  const cql = `INTERSECTS(geo_area_imovel, POINT(${lng} ${lat}))`;
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: sicarLayerForUF(uf),
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: '1',
    CQL_FILTER: cql,
  });
  try {
    const resp = await fetch(`${SICAR_WFS}?${params.toString()}`);
    if (!resp.ok) return null;
    const json = (await resp.json()) as GeoJSON.FeatureCollection;
    const f = json.features?.[0];
    if (!f) return null;
    const props = f.properties as Record<string, unknown>;
    return {
      cod_imovel: String(props.cod_imovel ?? ''),
      area: Number(props.area ?? 0),
      municipio: String(props.municipio ?? ''),
      uf: String(props.uf ?? uf),
      condicao: (props.condicao as string) ?? null,
      status_imovel: String(props.status_imovel ?? ''),
      tipo_imovel: String(props.tipo_imovel ?? ''),
      geometry: f.geometry as GeoJSON.MultiPolygon | GeoJSON.Polygon,
    };
  } catch {
    return null;
  }
}
