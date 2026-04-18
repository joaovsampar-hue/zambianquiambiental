import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { kml as kmlToGeoJson } from '@tmcw/togeojson';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Upload, MapPin, Trash2 } from 'lucide-react';
import { UF_CENTERS } from '@/lib/processStages';

// Fix default Leaflet marker icons in bundler
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export interface MapData {
  geojson: any | null;
  reference_lat: number | null;
  reference_lng: number | null;
  coordinates_text: string | null;
  kml_raw: string | null;
  source: string | null;
}

export interface PropertyMapHandle {
  /** Centraliza o mapa no centróide da UF (zoom estadual). Usado quando o CAR é digitado. */
  flyToUF: (uf: string) => void;
  /** Centraliza em coordenadas WGS84. */
  flyTo: (lat: number, lng: number, zoom?: number) => void;
}

interface Props {
  initialData?: Partial<MapData>;
  onChange: (data: MapData) => void;
  height?: string;
  readOnly?: boolean;
}

// Chave de persistência da camada base preferida do usuário
const BASE_LAYER_KEY = 'geodoc.map.baseLayer';

const PropertyMap = forwardRef<PropertyMapHandle, Props>(function PropertyMap(
  { initialData, onChange, height = '500px', readOnly },
  ref,
) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const layerGroup = useRef<L.LayerGroup | null>(null);
  const [coords, setCoords] = useState(initialData?.coordinates_text ?? '');
  const [refLat, setRefLat] = useState(initialData?.reference_lat?.toString() ?? '');
  const [refLng, setRefLng] = useState(initialData?.reference_lng?.toString() ?? '');
  const [clickedCoord, setClickedCoord] = useState<{ lat: number; lng: number } | null>(null);
  const dataRef = useRef<MapData>({
    geojson: initialData?.geojson ?? null,
    reference_lat: initialData?.reference_lat ?? null,
    reference_lng: initialData?.reference_lng ?? null,
    coordinates_text: initialData?.coordinates_text ?? null,
    kml_raw: initialData?.kml_raw ?? null,
    source: initialData?.source ?? null,
  });
  const { toast } = useToast();

  useImperativeHandle(ref, () => ({
    flyToUF: (uf: string) => {
      const c = UF_CENTERS[uf.toUpperCase()];
      if (c && mapInstance.current) mapInstance.current.flyTo([c[0], c[1]], c[2], { duration: 0.8 });
    },
    flyTo: (lat: number, lng: number, zoom = 14) => {
      mapInstance.current?.flyTo([lat, lng], zoom, { duration: 0.8 });
    },
  }), []);

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    // Leaflet usa por padrão CRS.EPSG3857 (Web Mercator) para tiles, MAS as coordenadas
    // de entrada/saída no Leaflet sempre são WGS84 (lat/lng EPSG:4326).
    // Isso garante compatibilidade com Google Earth, SIGEF e GPS.
    const map = L.map(mapRef.current, {
      center: [-15.78, -47.93], // Brasil
      zoom: 4,
      zoomControl: true,
    });
    mapInstance.current = map;

    // ===== CAMADAS BASE (mutuamente exclusivas) =====
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    });
    const esriImagery = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution:
          'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, GIS User Community',
        maxZoom: 19,
      },
    );
    const esriStreets = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Tiles © Esri', maxZoom: 19 },
    );

    // Satélite Esri por padrão (qualidade Maxar)
    esriImagery.addTo(map);

    // ===== OVERLAYS WMS DO SICAR (via proxy para evitar CORS) =====
    const wmsCommon = {
      format: 'image/png',
      transparent: true,
      version: '1.1.1',
      tileSize: 256,
      attribution: 'SICAR/SFB',
      maxZoom: 20,
      opacity: 0.6,
    };
    const sicarImoveis = L.tileLayer.wms(SICAR_WMS_PROXY, {
      ...wmsCommon,
      layers: 'sicar:area_imovel',
    });
    const sicarSigef = L.tileLayer.wms(SICAR_WMS_PROXY, {
      ...wmsCommon,
      layers: 'sicar:sigef_imoveis_certificados',
    });
    const sicarSnci = L.tileLayer.wms(SICAR_WMS_PROXY, {
      ...wmsCommon,
      layers: 'sicar:snci',
    });

    // Por padrão, mostra a camada principal de imóveis CAR
    sicarImoveis.addTo(map);

    // Painel de controle de camadas (canto superior direito)
    L.control
      .layers(
        {
          'Satélite (Esri/Maxar)': esriImagery,
          'Mapa (OpenStreetMap)': osm,
          'Ruas (Esri Streets)': esriStreets,
        },
        {
          'Imóveis CAR (SICAR)': sicarImoveis,
          'Certificados SIGEF': sicarSigef,
          'SNCI Brasil': sicarSnci,
        },
        { position: 'topright', collapsed: false },
      )
      .addTo(map);

    layerGroup.current = L.layerGroup().addTo(map);

    // Exibir coordenadas WGS84 ao clicar no mapa
    map.on('click', (e: L.LeafletMouseEvent) => {
      setClickedCoord({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    // Render initial geometry
    renderGeometry(dataRef.current);

    return () => {
      map.remove();
      mapInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (next: Partial<MapData>) => {
    dataRef.current = { ...dataRef.current, ...next };
    onChange(dataRef.current);
  };

  const renderGeometry = (d: MapData) => {
    const map = mapInstance.current;
    const lg = layerGroup.current;
    if (!map || !lg) return;
    lg.clearLayers();

    if (d.geojson) {
      const gj = L.geoJSON(d.geojson, {
        style: { color: 'hsl(152,55%,28%)', weight: 3, fillOpacity: 0.2 },
      });
      gj.addTo(lg);
      try {
        map.fitBounds(gj.getBounds(), { padding: [40, 40], maxZoom: 17 });
      } catch {
        // empty
      }
    }
    if (d.reference_lat != null && d.reference_lng != null) {
      const m = L.marker([d.reference_lat, d.reference_lng]);
      m.addTo(lg);
      if (!d.geojson) map.setView([d.reference_lat, d.reference_lng], 15);
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
      update({ geojson: geo, kml_raw: lower.endsWith('.kml') ? text : null, source: 'upload' });
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
    update({ reference_lat: lat, reference_lng: lng });
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
          return [parts[1], parts[0]] as [number, number]; // GeoJSON é [lng,lat]
        });
      if (points.length < 3) throw new Error('Mínimo 3 pontos para um polígono');
      const ring = [...points, points[0]];
      const geo = {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {},
      };
      update({ geojson: geo, coordinates_text: coords, source: 'manual' });
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
    renderGeometry(dataRef.current);
    if (mapInstance.current) mapInstance.current.setView([-15.78, -47.93], 4);
  };

  return (
    <div className="space-y-3">
      <div ref={mapRef} style={{ height, width: '100%' }} className="rounded-lg border border-border z-0" />

      {clickedCoord && (
        <div className="flex items-center justify-between text-xs px-3 py-1.5 bg-muted/50 rounded-md font-mono">
          <span className="text-muted-foreground">Coordenada (WGS84):</span>
          <span>{clickedCoord.lat.toFixed(6)}, {clickedCoord.lng.toFixed(6)}</span>
        </div>
      )}

      {!readOnly && (
        <>
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={handleClear}>
              <Trash2 className="w-4 h-4 mr-1.5" /> Limpar geometria
            </Button>
          </div>

          <Tabs defaultValue="kml" className="w-full">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="kml"><Upload className="w-4 h-4 mr-1.5" />KML/GeoJSON</TabsTrigger>
              <TabsTrigger value="coords">Coordenadas</TabsTrigger>
              <TabsTrigger value="ref"><MapPin className="w-4 h-4 mr-1.5" />Ponto ref.</TabsTrigger>
            </TabsList>
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
