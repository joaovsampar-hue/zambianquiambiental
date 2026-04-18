import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { kml as kmlToGeoJson } from '@tmcw/togeojson';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Upload, MapPin, Trash2, Search, Loader2 } from 'lucide-react';
import { UF_CENTERS } from '@/lib/processStages';
import {
  SICAR_UFS,
  SICAR_WMS,
  sicarLayerForUF,
  parseCarUF,
  fetchCarPolygon,
  fetchNeighborsInBbox,
  type SicarUF,
} from '@/lib/sicar';

// Fix default Leaflet marker icons in bundler
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export type GeometrySource = 'sicar' | 'kml_upload' | 'manual_draw' | 'manual_coords' | 'reference_only' | null;

export interface MapData {
  geojson: any | null;
  reference_lat: number | null;
  reference_lng: number | null;
  coordinates_text: string | null;
  kml_raw: string | null;
  source: GeometrySource;
}

export interface PropertyMapHandle {
  flyToUF: (uf: string) => void;
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  /** Busca o polígono no SICAR pelo número do CAR e renderiza no mapa. */
  loadCarPolygon: (car: string) => Promise<boolean>;
}

interface Props {
  initialData?: Partial<MapData>;
  onChange: (data: MapData) => void;
  height?: string;
  readOnly?: boolean;
  /** Quando informado, o usuário pode buscar o polígono SICAR pelo CAR vinculado ao processo. */
  carNumber?: string;
  /** Disparado quando o usuário busca um CAR válido pela aba CAR e o polígono é carregado com sucesso. */
  onCarLoaded?: (car: string) => void;
}

const BASE_LAYER_KEY = 'geodoc.map.baseLayer';

const PropertyMap = forwardRef<PropertyMapHandle, Props>(function PropertyMap(
  { initialData, onChange, height = '500px', readOnly, carNumber },
  ref,
) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const layerGroup = useRef<L.LayerGroup | null>(null);
  const neighborsLayer = useRef<L.LayerGroup | null>(null);
  const [coords, setCoords] = useState(initialData?.coordinates_text ?? '');
  const [refLat, setRefLat] = useState(initialData?.reference_lat?.toString() ?? '');
  const [refLng, setRefLng] = useState(initialData?.reference_lng?.toString() ?? '');
  const [carInput, setCarInput] = useState(carNumber ?? '');
  const [loadingCar, setLoadingCar] = useState(false);
  const [clickedCoord, setClickedCoord] = useState<{ lat: number; lng: number } | null>(null);
  const dataRef = useRef<MapData>({
    geojson: initialData?.geojson ?? null,
    reference_lat: initialData?.reference_lat ?? null,
    reference_lng: initialData?.reference_lng ?? null,
    coordinates_text: initialData?.coordinates_text ?? null,
    kml_raw: initialData?.kml_raw ?? null,
    source: (initialData?.source as GeometrySource) ?? null,
  });
  const [source, setSource] = useState<GeometrySource>(dataRef.current.source);
  const { toast } = useToast();

  useImperativeHandle(ref, () => ({
    flyToUF: (uf: string) => {
      const c = UF_CENTERS[uf.toUpperCase()];
      if (c && mapInstance.current) mapInstance.current.flyTo([c[0], c[1]], c[2], { duration: 0.8 });
    },
    flyTo: (lat: number, lng: number, zoom = 14) => {
      mapInstance.current?.flyTo([lat, lng], zoom, { duration: 0.8 });
    },
    loadCarPolygon: async (car: string) => loadCar(car),
  }), []);

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current, {
      center: [-15.78, -47.93],
      zoom: 4,
      zoomControl: true,
    });
    mapInstance.current = map;

    // ===== CAMADAS BASE (mutuamente exclusivas) =====
    const bases: Record<string, L.TileLayer> = {
      'Satélite (Esri/Maxar)': L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 20,
          attribution:
            '© Esri, Maxar, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN',
        },
      ),
      'Satélite HD (Clarity)': L.tileLayer(
        'https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 21, attribution: '© Esri, Maxar, Microsoft' },
      ),
      'Mapa de ruas (Esri)': L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 20, attribution: '© Esri' },
      ),
      'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }),
    };

    const savedBase = (typeof window !== 'undefined' && localStorage.getItem(BASE_LAYER_KEY)) || '';
    const initialBaseName = bases[savedBase] ? savedBase : 'Satélite (Esri/Maxar)';
    bases[initialBaseName].addTo(map);

    map.on('baselayerchange', (e: L.LayersControlEvent) => {
      try {
        localStorage.setItem(BASE_LAYER_KEY, e.name);
      } catch {
        /* ignore */
      }
    });

    // ===== OVERLAYS SICAR (uma camada WMS por UF, via Cloudflare Worker) =====
    // O usuário ativa só a UF que está trabalhando — evita carregar tiles desnecessários.
    // GeoServer SICAR usa WMS 1.3.0 + EPSG:4326 (ordem lat/lng); o Leaflet trata isso
    // automaticamente quando passamos `version: '1.3.0'`.
    const overlays: Record<string, L.Layer> = {};
    SICAR_UFS.forEach((uf) => {
      const wms = L.tileLayer.wms(SICAR_WMS, {
        layers: sicarLayerForUF(uf),
        format: 'image/png',
        transparent: true,
        version: '1.3.0',
        uppercase: true,
        attribution: 'SICAR/SFB',
        opacity: 0.55,
      } as L.WMSOptions);
      // Toast amigável quando o IBAMA está fora
      wms.on('tileerror', () => {
        // Evita spam — usa flag por instância
        const w = wms as L.TileLayer & { __notified?: boolean };
        if (w.__notified) return;
        w.__notified = true;
        toast({
          title: 'Camadas SICAR indisponíveis',
          description: 'O servidor do SFB pode estar fora do ar. Tente novamente em alguns minutos.',
          variant: 'destructive',
        });
      });
      overlays[`SICAR — ${uf}`] = wms;
    });

    L.control
      .layers(bases, overlays, { position: 'topright', collapsed: true })
      .addTo(map);

    layerGroup.current = L.layerGroup().addTo(map);
    neighborsLayer.current = L.layerGroup().addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      setClickedCoord({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    renderGeometry(dataRef.current);

    return () => {
      map.remove();
      mapInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (next: Partial<MapData>) => {
    dataRef.current = { ...dataRef.current, ...next };
    if (next.source !== undefined) setSource(next.source as GeometrySource);
    onChange(dataRef.current);
  };

  const renderGeometry = (d: MapData) => {
    const map = mapInstance.current;
    const lg = layerGroup.current;
    if (!map || !lg) return;
    lg.clearLayers();

    if (d.geojson) {
      const gj = L.geoJSON(d.geojson, {
        style: { color: 'hsl(152,55%,28%)', weight: 3, fillOpacity: 0.25, fillColor: 'hsl(152,55%,38%)' },
      });
      gj.addTo(lg);
      try {
        map.fitBounds(gj.getBounds(), { padding: [60, 60], maxZoom: 17 });
      } catch {
        /* empty */
      }
    }
    if (d.reference_lat != null && d.reference_lng != null) {
      const m = L.marker([d.reference_lat, d.reference_lng]);
      m.addTo(lg);
      if (!d.geojson) map.setView([d.reference_lat, d.reference_lng], 15);
    }
  };

  const renderNeighbors = (fc: GeoJSON.FeatureCollection, mainCar: string) => {
    const lg = neighborsLayer.current;
    if (!lg) return;
    lg.clearLayers();
    L.geoJSON(fc, {
      style: { color: '#3B82F6', weight: 1, fillColor: '#85B7EB', fillOpacity: 0.15 },
      onEachFeature: (feat, layer) => {
        const p = feat.properties as any;
        if (p?.cod_imovel && p.cod_imovel !== mainCar) {
          layer.bindPopup(
            `<div class="text-xs">
              <div class="font-semibold mb-1">CAR vizinho</div>
              <div class="font-mono break-all">${p.cod_imovel}</div>
              <div class="mt-1">Município: ${p.municipio ?? '—'}</div>
              <div>Área: ${p.area ? Number(p.area).toFixed(2) + ' ha' : '—'}</div>
            </div>`,
          );
        }
      },
    }).addTo(lg);
  };

  const loadCar = async (car: string): Promise<boolean> => {
    if (!car?.trim()) {
      toast({ title: 'Informe o número do CAR', variant: 'destructive' });
      return false;
    }
    setLoadingCar(true);
    try {
      const result = await fetchCarPolygon(car);
      if (result.ok === false) {
        const msg =
          result.reason === 'invalid_format'
            ? 'Formato inválido. Esperado: UF-XXXXXXX-...'
            : result.reason === 'not_found'
              ? 'CAR não encontrado no SICAR. Faça upload do KML ou desenhe o polígono manualmente.'
              : `Erro ao consultar SICAR: ${result.message}`;
        toast({ title: 'Polígono não carregado', description: msg, variant: 'destructive' });
        // Fallback: centraliza na UF
        const uf = parseCarUF(car);
        if (uf) {
          const c = UF_CENTERS[uf];
          if (c) mapInstance.current?.flyTo([c[0], c[1]], c[2], { duration: 0.8 });
        }
        return false;
      }
      const feat: GeoJSON.Feature = {
        type: 'Feature',
        geometry: result.feature.geometry,
        properties: {
          cod_imovel: result.feature.cod_imovel,
          area: result.feature.area,
          municipio: result.feature.municipio,
        },
      };
      update({ geojson: feat, source: 'sicar' });
      renderGeometry(dataRef.current);

      // Buscar vizinhos (não-bloqueante, ignora erro)
      try {
        const layer = L.geoJSON(result.feature.geometry as any);
        const b = layer.getBounds();
        const margin = 0.02; // ~2km
        const bbox: [number, number, number, number] = [
          b.getWest() - margin,
          b.getSouth() - margin,
          b.getEast() + margin,
          b.getNorth() + margin,
        ];
        const neighbors = await fetchNeighborsInBbox(
          result.feature.uf as SicarUF,
          bbox,
          result.feature.cod_imovel,
        );
        if (neighbors) renderNeighbors(neighbors, result.feature.cod_imovel);
      } catch {
        /* ignore neighbor errors */
      }

      toast({
        title: 'Polígono SICAR carregado',
        description: `${result.feature.municipio}/${result.feature.uf} — ${result.feature.area.toFixed(2)} ha`,
      });
      return true;
    } finally {
      setLoadingCar(false);
    }
  };

  const handleKmlUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      let geo: any;
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.kml')) {
        const dom = new DOMParser().parseFromString(text, 'text/xml');
        geo = kmlToGeoJson(dom);
      } else if (lower.endsWith('.geojson') || lower.endsWith('.json')) {
        geo = JSON.parse(text);
      } else {
        toast({ title: 'Formato não suportado', description: 'Envie .kml, .geojson ou .json', variant: 'destructive' });
        return;
      }
      update({ geojson: geo, kml_raw: lower.endsWith('.kml') ? text : null, source: 'kml_upload' });
      renderGeometry(dataRef.current);
      toast({ title: 'Geometria carregada' });
    } catch (err: any) {
      toast({ title: 'Erro ao ler arquivo', description: err.message, variant: 'destructive' });
    }
  };

  const handleApplyReference = () => {
    const lat = parseFloat(refLat);
    const lng = parseFloat(refLng);
    if (isNaN(lat) || isNaN(lng)) {
      toast({ title: 'Coordenadas inválidas', variant: 'destructive' });
      return;
    }
    update({ reference_lat: lat, reference_lng: lng, source: dataRef.current.geojson ? dataRef.current.source : 'reference_only' });
    renderGeometry(dataRef.current);
  };

  const handleApplyCoordinates = () => {
    try {
      const points = coords
        .split(/\n|;/)
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => {
          const parts = l.split(/[,\s]+/).map(parseFloat);
          if (parts.length < 2 || parts.some(isNaN)) throw new Error(`Linha inválida: ${l}`);
          return [parts[1], parts[0]] as [number, number];
        });
      if (points.length < 3) throw new Error('Mínimo 3 pontos para um polígono');
      const ring = [...points, points[0]];
      const geo = {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {},
      };
      update({ geojson: geo, coordinates_text: coords, source: 'manual_coords' });
      renderGeometry(dataRef.current);
      toast({ title: 'Polígono criado a partir das coordenadas' });
    } catch (err: any) {
      toast({ title: 'Erro nas coordenadas', description: err.message, variant: 'destructive' });
    }
  };

  const handleClear = () => {
    update({ geojson: null, kml_raw: null, coordinates_text: null, reference_lat: null, reference_lng: null, source: null });
    setCoords('');
    setRefLat('');
    setRefLng('');
    neighborsLayer.current?.clearLayers();
    renderGeometry(dataRef.current);
    if (mapInstance.current) mapInstance.current.setView([-15.78, -47.93], 4);
  };

  const sourceBadge = () => {
    switch (source) {
      case 'sicar':
        return <Badge className="bg-primary/15 text-primary border-primary/30">Polígono SICAR ✓</Badge>;
      case 'kml_upload':
        return <Badge className="bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300">KML importado ✓</Badge>;
      case 'manual_draw':
      case 'manual_coords':
        return <Badge variant="secondary">Desenhado manualmente</Badge>;
      case 'reference_only':
        return <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300">Apenas ponto de referência</Badge>;
      default:
        return <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300">Polígono pendente ⚠</Badge>;
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {sourceBadge()}
        {clickedCoord && (
          <span className="text-xs font-mono text-muted-foreground">
            {clickedCoord.lat.toFixed(6)}, {clickedCoord.lng.toFixed(6)}
          </span>
        )}
      </div>

      <div ref={mapRef} style={{ height, width: '100%' }} className="rounded-lg border border-border z-0" />

      {!readOnly && (
        <>
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={handleClear}>
              <Trash2 className="w-4 h-4 mr-1.5" /> Limpar geometria
            </Button>
          </div>

          <Tabs defaultValue="car" className="w-full">
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="car"><Search className="w-4 h-4 mr-1.5" />CAR</TabsTrigger>
              <TabsTrigger value="kml"><Upload className="w-4 h-4 mr-1.5" />KML</TabsTrigger>
              <TabsTrigger value="coords">Coords</TabsTrigger>
              <TabsTrigger value="ref"><MapPin className="w-4 h-4 mr-1.5" />Ponto</TabsTrigger>
            </TabsList>

            <TabsContent value="car" className="space-y-2">
              <Label>Buscar polígono pelo número do CAR</Label>
              <div className="flex gap-2">
                <Input
                  value={carInput}
                  onChange={e => setCarInput(e.target.value)}
                  placeholder="SP-3500402-0023CF6564CA47AD8EA6E0BDD0ED25C2"
                  className="font-mono text-xs"
                />
                <Button type="button" size="sm" onClick={() => loadCar(carInput)} disabled={loadingCar}>
                  {loadingCar ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  <span className="ml-1.5">Buscar</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Consulta direta no SICAR/SFB. Imóveis vizinhos no raio de ~2 km aparecem em azul (clique para ver detalhes).
              </p>
            </TabsContent>

            <TabsContent value="kml" className="space-y-2">
              <Label>Importar polígono (.kml, .geojson)</Label>
              <Input type="file" accept=".kml,.geojson,.json" onChange={handleKmlUpload} />
            </TabsContent>

            <TabsContent value="coords" className="space-y-2">
              <Label>Coordenadas WGS84 (uma por linha: latitude, longitude)</Label>
              <Textarea
                rows={6}
                placeholder="-15.78, -47.93&#10;-15.79, -47.92&#10;-15.80, -47.94"
                value={coords}
                onChange={e => setCoords(e.target.value)}
              />
              <Button type="button" size="sm" onClick={handleApplyCoordinates}>Criar polígono</Button>
            </TabsContent>

            <TabsContent value="ref" className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Latitude (WGS84)</Label>
                  <Input value={refLat} onChange={e => setRefLat(e.target.value)} placeholder="-15.78" />
                </div>
                <div>
                  <Label>Longitude (WGS84)</Label>
                  <Input value={refLng} onChange={e => setRefLng(e.target.value)} placeholder="-47.93" />
                </div>
              </div>
              <Button type="button" size="sm" onClick={handleApplyReference}>Marcar ponto</Button>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
});

export default PropertyMap;
