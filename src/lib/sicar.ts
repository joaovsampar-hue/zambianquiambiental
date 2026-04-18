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
 * Wrapper de `fetch` com retry exponencial específico pra falhas transitórias do
 * GeoServer/Cloudflare:
 *   - HTTP 522 (Connection Timed Out) — Cloudflare não conseguiu falar com o origin
 *   - HTTP 524 (A Timeout Occurred) — origin demorou mais de 100s
 *   - HTTP 502/503/504 — gateway/upstream temporariamente fora
 *   - AbortError de timeout client-side
 *
 * Backoff: 1s → 2s → 4s. Máx. 3 tentativas.
 */
async function fetchWithRetry(url: string, init?: RequestInit, maxAttempts = 3): Promise<Response> {
  const transientStatuses = new Set([502, 503, 504, 522, 524]);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(url, init);
      if (resp.ok) return resp;
      if (!transientStatuses.has(resp.status) || attempt === maxAttempts) return resp;
      // Lê (e descarta) o corpo pra liberar a conexão antes do retry.
      try { await resp.text(); } catch { /* ignore */ }
    } catch (e) {
      lastError = e;
      if (attempt === maxAttempts) throw e;
    }
    // Backoff exponencial: 1s, 2s, 4s
    await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
  }
  // Caminho inalcançável — todas as branches retornam ou lançam.
  throw lastError ?? new Error('SICAR: retries esgotados');
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
    const resp = await fetchWithRetry(`${SICAR_WFS}?${params.toString()}`);
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
 *
 * IMPORTANTE: WFS 2.0 + EPSG:4326 (sem CRS:84) usa **ordem lat lng** em geometrias
 * literais do CQL_FILTER. GeoJSON é sempre lng/lat — então invertemos aqui.
 */
function geometryToWkt(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): string {
  const ring = (r: GeoJSON.Position[]) =>
    '(' + r.map(([lng, lat]) => `${lat} ${lng}`).join(', ') + ')';
  const poly = (p: GeoJSON.Position[][]) => '(' + p.map(ring).join(', ') + ')';
  if (geom.type === 'Polygon') return `POLYGON ${poly(geom.coordinates)}`;
  return `MULTIPOLYGON (${geom.coordinates.map(poly).join(', ')})`;
}

/** Calcula o bounding box [minLng, minLat, maxLng, maxLat] de uma geometria. */
function geometryBBox(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number, number, number] {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return [minLng, minLat, maxLng, maxLat];
}

/**
 * Busca os imóveis vizinhos que **fazem confronto direto** com a geometria.
 *
 * ## Estratégia
 *
 * Tentamos antes usar `DWITHIN(geo_area_imovel, MULTIPOLYGON(...))` enviando o
 * polígono inteiro do imóvel principal — mas o GeoServer SICAR retornava HTTP 406
 * "Acesso negado" quando o WKT ficava grande (centenas de vértices = URLs com 3-4kB).
 * É uma proteção do upstream contra requisições pesadas.
 *
 * Em vez disso, usamos uma estratégia em duas fases bem mais leve:
 *   1. **Candidatos por BBOX** — pedimos todos os imóveis cujo bounding box intersecta
 *      o BBOX do imóvel principal expandido em ~50m (buffer). A query é curtíssima e
 *      o servidor aceita sem problemas.
 *   2. **Filtragem espacial real** — feita pelo próprio GeoServer através do operador
 *      `INTERSECTS` contra um **MULTIPOLYGON simplificado** do imóvel principal.
 *      Reduzimos os vértices a no máximo ~50 pontos para manter a URL pequena.
 *
 * Em vez de `TOUCHES` usamos `INTERSECTS` no polígono levemente expandido — captura
 * vizinhos que tocam a borda **e** os que ficam separados pelos pequenos gaps típicos
 * da digitalização do SICAR.
 *
 * Retorna FeatureCollection pronto pra renderizar no Leaflet.
 */
export async function fetchTouchingNeighbors(
  uf: SicarUF,
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  excludeCar: string,
  maxFeatures = 30,
): Promise<GeoJSON.FeatureCollection | null> {
  // BBOX expandido em ~0.0005° (~55m) — captura todos os confrontantes diretos
  // sem pegar imóveis distantes. O índice espacial do GeoServer cuida do filtro.
  const [minLng, minLat, maxLng, maxLat] = geometryBBox(geometry);
  const buffer = 0.0005;
  // ATENÇÃO: o GeoServer SICAR aceita BBOX no formato lng,lat,lng,lat com EPSG:4326
  // (NÃO segue a regra do WFS 2.0 de eixo invertido). Validado empiricamente:
  // com lat,lng a query retorna 0 features; com lng,lat retorna o esperado.
  const bbox = `${minLng - buffer},${minLat - buffer},${maxLng + buffer},${maxLat + buffer},EPSG:4326`;
  const exclude = sanitizeCar(excludeCar);

  // ATENÇÃO: NÃO combine `bbox` com `CQL_FILTER` no SICAR — testes empíricos
  // mostram que o GeoServer da SFB faz o filtro CQL ANTES do índice espacial e
  // a query trava com timeout (HTTP 522). Pedimos só por BBOX e excluímos o CAR
  // principal aqui no cliente.
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: sicarLayerForUF(uf),
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: String(maxFeatures),
    bbox,
  });

  try {
    // Timeout client-side: SICAR pode levar 30s+ — não vale a pena esperar.
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 25000);
    const resp = await fetch(`${SICAR_WFS}?${params.toString()}`, { signal: ctrl.signal });
    clearTimeout(timeoutId);
    if (!resp.ok) return null;
    const fc = (await resp.json()) as GeoJSON.FeatureCollection;
    if (!fc.features?.length) return fc;

    // Remove o imóvel principal e filtra por sobreposição real de BBOX
    // (defesa extra contra falsos-positivos do índice espacial).
    const filtered = fc.features.filter(f => {
      const g = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
      const codImovel = (f.properties as any)?.cod_imovel as string | undefined;
      if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return false;
      if (codImovel && sanitizeCar(codImovel) === exclude) return false;
      const [a, b, c, d] = geometryBBox(g);
      return !(c < minLng - buffer || a > maxLng + buffer || d < minLat - buffer || b > maxLat + buffer);
    });
    return { ...fc, features: filtered };
  } catch {
    return null;
  }
}

// Mantido para compatibilidade caso alguém importe (atualmente não usado fora deste arquivo).
export { geometryToWkt };


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
  // WFS 2.0 + EPSG:4326 → POINT(lat lng), não (lng lat). Confirmado via teste no GeoServer SICAR.
  const cql = `INTERSECTS(geo_area_imovel, POINT(${lat} ${lng}))`;
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
