import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { kml as kmlToGeoJson } from '@tmcw/togeojson';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Upload, MapPin, Layers, Trash2 } from 'lucide-react';

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

interface Props {
  initialData?: Partial<MapData>;
  onChange: (data: MapData) => void;
  height?: string;
  readOnly?: boolean;
}

export default function PropertyMap({ initialData, onChange, height = '500px', readOnly }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const layerGroup = useRef<L.LayerGroup | null>(null);
  const sicarLayer = useRef<L.TileLayer.WMS | null>(null);
  const [showSicar, setShowSicar] = useState(true);
  const [baseLayer, setBaseLayer] = useState<'osm' | 'sat'>('sat');
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const [coords, setCoords] = useState(initialData?.coordinates_text ?? '');
  const [refLat, setRefLat] = useState(initialData?.reference_lat?.toString() ?? '');
  const [refLng, setRefLng] = useState(initialData?.reference_lng?.toString() ?? '');
  const dataRef = useRef<MapData>({
    geojson: initialData?.geojson ?? null,
    reference_lat: initialData?.reference_lat ?? null,
    reference_lng: initialData?.reference_lng ?? null,
    coordinates_text: initialData?.coordinates_text ?? null,
    kml_raw: initialData?.kml_raw ?? null,
    source: initialData?.source ?? null,
  });
  const { toast } = useToast();

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current, {
      center: [-15.78, -47.93], // Brasil
      zoom: 5,
      zoomControl: true,
    });
    mapInstance.current = map;

    const sat = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: '© Esri', maxZoom: 19 }
    );
    sat.addTo(map);
    baseLayerRef.current = sat;

    // Camada WMS oficial do SICAR (imóveis CAR)
    const sicar = L.tileLayer.wms('https://geoserver.car.gov.br/geoserver/sicar/wms', {
      layers: 'sicar:area_imovel',
      format: 'image/png',
      transparent: true,
      version: '1.1.0',
      attribution: 'SICAR/SFB',
      opacity: 0.6,
    });
    sicar.addTo(map);
    sicarLayer.current = sicar;

    layerGroup.current = L.layerGroup().addTo(map);

    // Render initial geometry
    renderGeometry(dataRef.current);

    return () => {
      map.remove();
      mapInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toggle SICAR layer
  useEffect(() => {
    const map = mapInstance.current;
    const layer = sicarLayer.current;
    if (!map || !layer) return;
    if (showSicar) layer.addTo(map);
    else map.removeLayer(layer);
  }, [showSicar]);

  // Switch base layer
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !baseLayerRef.current) return;
    map.removeLayer(baseLayerRef.current);
    const url =
      baseLayer === 'osm'
        ? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
        : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    const attr = baseLayer === 'osm' ? '© OpenStreetMap' : '© Esri';
    const newBase = L.tileLayer(url, { attribution: attr, maxZoom: 19 });
    newBase.addTo(map);
    baseLayerRef.current = newBase;
  }, [baseLayer]);

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
      if (file.name.toLowerCase().endsWith('.kml')) {
        const dom = new DOMParser().parseFromString(text, 'text/xml');
        geo = kmlToGeoJson(dom);
      } else if (file.name.toLowerCase().endsWith('.geojson') || file.name.toLowerCase().endsWith('.json')) {
        geo = JSON.parse(text);
      } else {
        toast({ title: 'Formato não suportado', description: 'Envie .kml, .geojson ou .json', variant: 'destructive' });
        return;
      }
      update({ geojson: geo, kml_raw: file.name.endsWith('.kml') ? text : null, source: 'upload' });
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
    // Parse: lines of "lat,lng" or "lat lng" → polygon
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
      // Fechar o anel
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
    if (mapInstance.current) mapInstance.current.setView([-15.78, -47.93], 5);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border overflow-hidden text-xs">
          <button
            onClick={() => setBaseLayer('sat')}
            className={`px-3 py-1.5 ${baseLayer === 'sat' ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
          >
            Satélite
          </button>
          <button
            onClick={() => setBaseLayer('osm')}
            className={`px-3 py-1.5 ${baseLayer === 'osm' ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
          >
            Mapa
          </button>
        </div>
        <Button
          type="button"
          variant={showSicar ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowSicar(s => !s)}
        >
          <Layers className="w-4 h-4 mr-1.5" /> Camada CAR
        </Button>
        {!readOnly && (
          <Button type="button" variant="outline" size="sm" onClick={handleClear}>
            <Trash2 className="w-4 h-4 mr-1.5" /> Limpar
          </Button>
        )}
      </div>

      <div ref={mapRef} style={{ height, width: '100%' }} className="rounded-lg border border-border z-0" />

      {!readOnly && (
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
            <Label>Coordenadas (uma por linha: latitude, longitude)</Label>
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
                <Label>Latitude</Label>
                <Input value={refLat} onChange={e => setRefLat(e.target.value)} placeholder="-15.78" />
              </div>
              <div>
                <Label>Longitude</Label>
                <Input value={refLng} onChange={e => setRefLng(e.target.value)} placeholder="-47.93" />
              </div>
            </div>
            <Button type="button" size="sm" onClick={handleApplyReference}>Marcar ponto</Button>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
