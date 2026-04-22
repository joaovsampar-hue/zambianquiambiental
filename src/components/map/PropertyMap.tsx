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
import { Upload, MapPin, Trash2, Search, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { UF_CENTERS } from '@/lib/processStages';
import {
  SICAR_UFS,
  SICAR_WMS,
  sicarLayerForUF,
  parseCarUF,
  fetchCarPolygon,
  fetchTouchingNeighbors,
  fetchFeatureAtPoint,
  sanitizeCar,
  type SicarUF,
} from '@/lib/sicar';
import { SIGEF_PROXY_WMS, SIGEF_UFS, SIGEF_INFO_FORMAT, sigefLayerForUF, parseSigefInfoHtml, type SigefUF } from '@/lib/sigefIncra';
import { loadSnciGeoJSON } from '@/lib/snci';

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

export interface RenderedMapFeatures {
  /** Polígono do imóvel principal (em estudo). null se ainda não carregado. */
  main: GeoJSON.Feature | null;
  /** Polígonos dos vizinhos detectados via SICAR (TOUCHES). */
  neighbors: GeoJSON.FeatureCollection | null;
}

export interface PropertyMapHandle {
  flyToUF: (uf: string) => void;
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  /** Busca o polígono no SICAR pelo número do CAR e renderiza no mapa. */
  loadCarPolygon: (car: string) => Promise<boolean>;
  /** Retorna a instância Leaflet — usado pra exportação do mapa. */
  getMap: () => L.Map | null;
  /** Retorna o container DOM raiz do mapa — usado pra captura de screenshot. */
  getContainer: () => HTMLElement | null;
  /** Devolve as features atualmente renderizadas — usado pela exportação vetorial. */
  getRenderedFeatures: () => RenderedMapFeatures;
  /** Esconde temporariamente camadas WMS (SICAR/SIGEF tiles) — usado durante captura PDF. */
  setOverlayTilesVisible: (visible: boolean) => void;
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
  /** Disparado quando o usuário clica em "Adicionar como confrontante" no popup de um imóvel identificado pelo clique. */
  onNeighborPick?: (info: { car: string; area: number; municipio: string; uf: string; matricula?: string }) => void;
  /** Disparado quando os confrontantes diretos (TOUCHES) são detectados automaticamente após o carregamento do CAR principal. */
  onNeighborsDetected?: (neighbors: Array<{ car: string; area: number; municipio: string; uf: string; matricula?: string }>) => void;
  /** Conjunto de CARs marcados no painel de seleção — usado pra destacar polígonos selecionados no mapa. */
  selectedNeighbors?: Set<string>;
  /** Alterna a marcação de um CAR no painel ao clicar no botão "Marcar/Desmarcar do painel" do popup. */
  onNeighborToggle?: (car: string) => void;
  /** CARs já cadastrados como confrontantes — pintados em verde (e não permitem cadastro duplicado). */
  registeredNeighbors?: Set<string>;
  /** Rótulo amigável para o tooltip do polígono principal (ex: denominação do imóvel). */
  mainPropertyLabel?: string;
}

const BASE_LAYER_KEY = 'geodoc.map.baseLayer';

const PropertyMap = forwardRef<PropertyMapHandle, Props>(function PropertyMap(
  { initialData, onChange, height = '500px', readOnly, carNumber, onCarLoaded, onNeighborPick, onNeighborsDetected, selectedNeighbors, onNeighborToggle, registeredNeighbors, mainPropertyLabel },
  ref,
) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const layerGroup = useRef<L.LayerGroup | null>(null);
  const neighborsLayer = useRef<L.LayerGroup | null>(null);
  // Camadas SICAR/SIGEF — uma única WMS por serviço, escopada à UF do imóvel
  // (detectada pelo número do CAR). Antes carregávamos as 27 UFs em paralelo,
  // o que travava o mapa por vários segundos a cada toggle.
  const sigefWmsByUFRef = useRef<Map<string, L.TileLayer.WMS> | null>(null);
  const sigefActiveUFs = useRef<Set<SigefUF>>(new Set());
  const sicarGroupRef = useRef<L.LayerGroup | null>(null);
  const sigefGroupRef = useRef<L.LayerGroup | null>(null);
  const snciGroupRef = useRef<L.LayerGroup | null>(null);
  // UF atualmente carregada nos overlays (evita reinstanciar quando não muda).
  const currentUfRef = useRef<string | null>(null);
  const sigefInfoLayer = useRef<L.LayerGroup | null>(null);
  const sigefIdentifyToken = useRef<number>(0);
  const [coords, setCoords] = useState(initialData?.coordinates_text ?? '');
  const [carInput, setCarInput] = useState(carNumber ?? '');
  const [loadingCar, setLoadingCar] = useState(false);
  const [clickedCoord, setClickedCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Status da consulta de confrontantes ao SICAR — alimenta o badge de status.
  const [neighborStatus, setNeighborStatus] = useState<'idle' | 'loading' | 'done' | 'empty' | 'error'>('idle');
  const [neighborCount, setNeighborCount] = useState(0);
  // Status da camada SIGEF — alimenta um badge separado quando ativa.
  // (sigefStatus removido — SIGEF agora é tile WMS, não há fetch dinâmico para reportar.)
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
  // Refs para handlers chamados de dentro de listeners do Leaflet (registrados 1x).
  const identifyRef = useRef<(lat: number, lng: number) => Promise<void>>(async () => {});
  const loadedCarsRef = useRef<Set<string>>(new Set());
  // Mapa CAR → layer Leaflet do polígono vizinho. Permite re-estilizar
  // quando a seleção do painel muda, sem refazer toda a render.
  const neighborLayersRef = useRef<Map<string, L.Path>>(new Map());
  // Cache de features já buscadas — evita re-fetch a cada mudança de seleção.
  const fetchedFeaturesRef = useRef<Map<string, GeoJSON.Feature>>(new Map());
  // FeatureCollection raw dos vizinhos detectados (para exportação vetorial em PDF).
  const neighborsFcRef = useRef<GeoJSON.FeatureCollection | null>(null);
  // Refs com versão sempre-atual das props que dependem do React state —
  // usadas dentro de handlers do popup que são registrados uma única vez.
  const selectedNeighborsRef = useRef<Set<string>>(selectedNeighbors ?? new Set());
  const onNeighborToggleRef = useRef<typeof onNeighborToggle>(onNeighborToggle);
  const registeredNeighborsRef = useRef<Set<string>>(registeredNeighbors ?? new Set());
  selectedNeighborsRef.current = selectedNeighbors ?? new Set();
  onNeighborToggleRef.current = onNeighborToggle;
  registeredNeighborsRef.current = registeredNeighbors ?? new Set();

  useImperativeHandle(ref, () => ({
    flyToUF: (uf: string) => {
      const c = UF_CENTERS[uf.toUpperCase()];
      if (c && mapInstance.current) mapInstance.current.flyTo([c[0], c[1]], c[2], { duration: 0.8 });
    },
    flyTo: (lat: number, lng: number, zoom = 14) => {
      mapInstance.current?.flyTo([lat, lng], zoom, { duration: 0.8 });
    },
    loadCarPolygon: async (car: string) => loadCar(car),
    getMap: () => mapInstance.current,
    getContainer: () => mapRef.current,
    getRenderedFeatures: () => {
      const gj = dataRef.current.geojson;
      const main: GeoJSON.Feature | null = gj
        ? (gj.type === 'Feature' ? gj : { type: 'Feature', geometry: gj.geometry ?? gj, properties: gj.properties ?? {} })
        : null;
      return { main, neighbors: neighborsFcRef.current };
    },
    setOverlayTilesVisible: (visible: boolean) => {
      const sicar = sicarGroupRef.current;
      const sigef = sigefGroupRef.current;
      const snci = snciGroupRef.current;
      const main = layerGroup.current;
      const neighbors = neighborsLayer.current;
      const map = mapInstance.current;
      if (!map) return;
      // Esconde TUDO que não é basemap durante a captura para o PDF.
      [sicar, sigef, snci, main, neighbors].forEach(group => {
        if (!group) return;
        group.eachLayer(l => {
          const el = (l as any).getContainer?.() as HTMLElement | undefined;
          if (el) el.style.visibility = visible ? '' : 'hidden';
          const path = (l as any)._path as SVGElement | undefined;
          if (path) path.style.opacity = visible ? '' : '0';
        });
      });
      const overlayPane = map.getPane('overlayPane');
      if (overlayPane) overlayPane.style.opacity = visible ? '' : '0';
    },
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
          crossOrigin: 'anonymous',
          attribution:
            '© Esri, Maxar, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN',
        },
      ),
      'Satélite HD (Clarity)': L.tileLayer(
        'https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 21, crossOrigin: 'anonymous', attribution: '© Esri, Maxar, Microsoft' },
      ),
      'Mapa de ruas (Esri)': L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 20, crossOrigin: 'anonymous', attribution: '© Esri' },
      ),
      'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        crossOrigin: 'anonymous',
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

    // ===== OVERLAYS SICAR/SIGEF (escopados à UF do imóvel) =====
    // Antes carregávamos as 27 UFs em paralelo — virou tela travada por 5–10s
    // a cada toggle. Agora detectamos a UF a partir do número do CAR (ex: "SP")
    // e instanciamos UMA única camada WMS por serviço.
    //
    // ITEM 5: ao abrir o mapa, somente a camada SICAR fica ativa por padrão.
    // SIGEF e Confrontantes ficam disponíveis no controle de camadas mas começam
    // DESLIGADOS — o usuário ativa quando precisar.
    const sicarGroup = L.layerGroup();
    const sigefGroup = L.layerGroup();
    const snciGroup = L.layerGroup();
    const neighborsGroup = L.layerGroup();
    sigefWmsByUFRef.current = new Map();
    sicarGroupRef.current = sicarGroup;
    sigefGroupRef.current = sigefGroup;
    snciGroupRef.current = snciGroup;

    layerGroup.current = L.layerGroup().addTo(map); // imóvel principal — sempre visível
    neighborsLayer.current = neighborsGroup;
    neighborsGroup.addTo(map); // confrontantes cadastrados ficam visíveis por padrão
    // sicarGroup removido do init automático

    const overlays: Record<string, L.Layer> = {
      'SICAR': sicarGroup,
      'SIGEF/INCRA': sigefGroup,
      'SNCI/INCRA (1ª Norma)': snciGroup,
      'Confrontantes cadastrados': neighborsGroup,
    };

    L.control
      .layers(bases, overlays, { position: 'topright', collapsed: true })
      .addTo(map);

    // Camada de popups dos cliques SIGEF — separada para limpar facilmente.
    sigefInfoLayer.current = L.layerGroup().addTo(map);

    // Toggle do grupo SIGEF: ativa/desativa GetFeatureInfo para a UF carregada.
    map.on('overlayadd', async (e: L.LayersControlEvent) => {
      if (e.name === 'SIGEF/INCRA' && currentUfRef.current) {
        sigefActiveUFs.current.add(currentUfRef.current as SigefUF);
      }

      // SNCI — carrega GeoJSON estático sob demanda ao ativar a camada
      if (e.name === 'SNCI/INCRA (1ª Norma)' && currentUfRef.current) {
        const snciGroup = snciGroupRef.current;
        if (!snciGroup) return;

        // Indicador visual de carregamento
        const loadingLayer = L.marker(map.getCenter(), {
          icon: L.divIcon({
            className: '',
            html: '<div class="bg-background/80 backdrop-blur-sm border border-border px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2 text-xs font-medium"><div class="w-3 h-3 border-2 border-primary border-t-transparent animate-spin rounded-full"></div>Carregando SNCI…</div>',
            iconAnchor: [60, 12],
          }),
        }).addTo(snciGroup);

        const uf = currentUfRef.current;
        const fc = await loadSnciGeoJSON(uf);
        snciGroup.removeLayer(loadingLayer);

        if (!fc) {
          toast({
            title: 'SNCI não disponível',
            description: `Arquivo SNCI para ${uf.toUpperCase()} não encontrado. Faça o upload do GeoJSON no Supabase Storage (bucket: snci-data).`,
            variant: 'destructive',
          });
          return;
        }

        // Renderiza os polígonos SNCI em roxo escuro para diferenciação visual
        L.geoJSON(fc, {
          style: {
            color: '#6B21A8',
            weight: 1.5,
            fillColor: '#A855F7',
            fillOpacity: 0.15,
            opacity: 0.8,
          },
          onEachFeature: (feat, layer) => {
            const p = feat.properties as any;
            if (!p) return;
            const nome = p.nome_imove || p.nome_imovel || '—';
            const area = p.qtd_area_p ? Number(p.qtd_area_p).toFixed(4) + ' ha' : '—';
            const certif = p.num_certif || '—';
            const dataCert = p.data_certi || '—';
            const codImovel = p.cod_imovel || '—';
            const uf = p.uf_municip || '—';
            const processo = p.num_proces || '—';
            const profissional = p.cod_profis || '—';
            const areaNum = p.qtd_area_p ? Number(p.qtd_area_p) : 0;

            // Extrai UF e município do campo uf_municip (formato: "SP" ou "SP/Valparaíso")
            const ufCode = uf.split('/')[0]?.trim() || '';
            const municipio = uf.split('/')[1]?.trim() || uf;

            const btnId = `snci-neighbor-${String(codImovel).replace(/[^A-Za-z0-9]/g, '')}`;
            const showBtn = !!onNeighborPick;

            const html = `
              <div class="text-xs space-y-1.5" style="min-width:240px">
                <div class="font-semibold" style="color:#6B21A8">📋 SNCI/INCRA — 1ª Norma</div>
                <div><span class="text-muted-foreground">Imóvel:</span> ${nome}</div>
                <div><span class="text-muted-foreground">Área:</span> ${area}</div>
                <div><span class="text-muted-foreground">Certificação:</span> ${certif}</div>
                <div><span class="text-muted-foreground">Data:</span> ${dataCert}</div>
                <div><span class="text-muted-foreground">Cód. imóvel:</span> ${codImovel}</div>
                <div><span class="text-muted-foreground">UF/Município:</span> ${uf}</div>
                <div><span class="text-muted-foreground">Processo:</span> ${processo}</div>
                <div><span class="text-muted-foreground">Profissional:</span> ${profissional}</div>
                ${showBtn ? `
                <div class="pt-1">
                  <button id="${btnId}" class="px-2 py-1 rounded bg-secondary text-secondary-foreground text-xs border border-border">
                    + Listar como confrontante
                  </button>
                </div>` : ''}
              </div>`;

            (layer as L.Path).bindPopup(html, { maxWidth: 320 });

            layer.on('click', (_e: any) => {
              // Não bloqueia propagação — permite que identifyAtPoint
              // rode em paralelo e mostre dados do SICAR/SIGEF no mesmo ponto.
            });

            layer.on('popupopen', () => {
              if (!showBtn) return;
              document.getElementById(btnId)?.addEventListener('click', () => {
                (layer as any).closePopup?.();

                // Identificador único com prefixo SNCI: para não conflitar com CARs.
                // Usamos o número da certificação como base do ID para permitir a reconstrução no ProcessDetailPage.
                const snciId = `SNCI:${certif !== '—' ? certif : String(codImovel)}`;

                // Armazena a geometry diretamente no cache para não precisar buscar no SICAR
                if (!fetchedFeaturesRef.current.has(snciId)) {
                  const geometry = (feat as GeoJSON.Feature).geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
                  fetchedFeaturesRef.current.set(snciId, {
                    type: 'Feature',
                    geometry,
                    properties: {
                      cod_imovel: snciId,
                      area: areaNum,
                      municipio: municipio,
                      uf: ufCode,
                      snci: true,
                      num_certif: certif,
                      nome_imove: nome,
                    },
                  });
                }

                onNeighborPick?.({
                  car: snciId,           // prefixado com SNCI: — identifica a origem
                  area: areaNum,
                  municipio: municipio,
                  uf: ufCode,
                  matricula: certif !== '—' ? certif : undefined,
                });
              });
            });
          },
        }).addTo(snciGroup);
      }
    });

    map.on('overlayremove', (e: L.LayersControlEvent) => {
      if (e.name === 'SIGEF/INCRA') {
        sigefActiveUFs.current.clear();
        sigefInfoLayer.current?.clearLayers();
      }
      // SNCI — limpa layers ao desativar (mantém cache em memória)
      if (e.name === 'SNCI/INCRA (1ª Norma)') {
        snciGroupRef.current?.clearLayers();
      }
    });

    map.on('click', async (e: L.LeafletMouseEvent) => {
      setClickedCoord({ lat: e.latlng.lat, lng: e.latlng.lng });
      // O popup combinado (CAR + SIGEF) é montado dentro de identifyAtPoint —
      // ele dispara a consulta SIGEF em paralelo e mescla o HTML quando chega.
      await identifyRef.current(e.latlng.lat, e.latlng.lng);
    });

    renderGeometry(dataRef.current);

    return () => {
      map.remove();
      mapInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Escopa SICAR/SIGEF à UF do imóvel =====
  // Detecta a UF do CAR (ex: "SP-3500402-...") e instancia uma única WMS por
  // serviço dentro dos LayerGroups vazios criados na init. Sem CAR, mostra
  // SP por padrão (cobre Mariápolis e a maior parte do uso).
  useEffect(() => {
    const map = mapInstance.current;
    const sicarGroup = sicarGroupRef.current;
    const sigefGroup = sigefGroupRef.current;
    if (!map || !sicarGroup || !sigefGroup) return;
    const uf = (carNumber && parseCarUF(carNumber)) || 'SP';
    if (currentUfRef.current === uf) return;
    currentUfRef.current = uf;

    // Limpa camadas anteriores e mapeamentos.
    sicarGroup.clearLayers();
    sigefGroup.clearLayers();
    snciGroupRef.current?.clearLayers();
    sigefWmsByUFRef.current?.clear();

    // SICAR — uma WMS para a UF do imóvel.
    // ITEM 6 — Camada 1: a WMS é renderizada pelo SFB (linhas laranja). Mantemos
    // opacidade 0.85 para que as linhas fiquem nítidas sobre o satélite.
    if ((SICAR_UFS as readonly string[]).includes(uf)) {
      const wmsSicar = L.tileLayer.wms(SICAR_WMS, {
        layers: sicarLayerForUF(uf),
        format: 'image/png',
        transparent: true,
        version: '1.3.0',
        uppercase: true,
        attribution: 'SICAR/SFB',
        opacity: 0.85,
      } as L.WMSOptions);
      wmsSicar.on('tileerror', () => {
        const w = wmsSicar as L.TileLayer & { __notified?: boolean };
        if (w.__notified) return;
        w.__notified = true;
        toast({
          title: 'SICAR indisponível',
          description: 'O servidor do SFB pode estar fora do ar. Tente novamente em alguns minutos.',
          variant: 'destructive',
        });
      });
      sicarGroup.addLayer(wmsSicar);
    }

    // SIGEF — idem.
    if ((SIGEF_UFS as readonly string[]).includes(uf)) {
      const wmsSigef = L.tileLayer.wms(SIGEF_PROXY_WMS, {
        layers: sigefLayerForUF(uf),
        format: 'image/png',
        transparent: true,
        version: '1.1.1',
        uppercase: true,
        attribution: 'SIGEF/INCRA',
        opacity: 0.65,
      } as L.WMSOptions);
      wmsSigef.on('tileerror', () => {
        const w = wmsSigef as L.TileLayer & { __notified?: boolean };
        if (w.__notified) return;
        w.__notified = true;
        toast({
          title: 'SIGEF/INCRA indisponível',
          description: 'O acervo fundiário do INCRA está fora do ar. Tente em alguns minutos.',
          variant: 'destructive',
        });
      });
      sigefWmsByUFRef.current?.set(uf, wmsSigef);
      sigefGroup.addLayer(wmsSigef);
      // Se o overlay SIGEF já estiver visível, atualiza o set de UFs ativas.
      if (map.hasLayer(sigefGroup)) {
        sigefActiveUFs.current.clear();
        sigefActiveUFs.current.add(uf as SigefUF);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carNumber]);

  // F6 — Removida a busca automática de confrontantes (TOUCHES) ao carregar
  // o polígono do imóvel. Confrontantes só aparecem no mapa quando cadastrados
  // manualmente em process_neighbors. Mantemos apenas SICAR (WMS de fundo) +
  // polígono do cliente. O usuário ainda pode clicar em qualquer parcela SICAR
  // para identificar e adicionar como confrontante via popup.

  // Quando o container muda de tamanho (entra/sai de fullscreen), o Leaflet
  // precisa recalcular o tamanho dos tiles, senão fica metade cinza.
  useEffect(() => {
    if (!mapInstance.current) return;
    const id = window.setTimeout(() => mapInstance.current?.invalidateSize(), 220);
    return () => window.clearTimeout(id);
  }, [fullscreen]);

  // Esc para sair do modo expandido.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    // Trava scroll do body enquanto o mapa cobre a tela.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  const update = (next: Partial<MapData>) => {
    dataRef.current = { ...dataRef.current, ...next };
    if (next.source !== undefined) setSource(next.source as GeometrySource);
    onChange(dataRef.current);
  };

  // Consulta as parcelas SIGEF no ponto clicado, via WMS GetFeatureInfo no proxy.
  // Roda em paralelo para todas as UFs SIGEF ativas e devolve o HTML do popup
  // (ou null se não há certificação no ponto). Não abre popup próprio — o
  // chamador (`identifyAtPoint`) mescla com o bloco do CAR.
  const identifySigefAtPoint = async (lat: number, lng: number): Promise<string | null> => {
    const map = mapInstance.current;
    if (!map || sigefActiveUFs.current.size === 0) return null;
    const token = ++sigefIdentifyToken.current;

    // BBOX 1×1 pixel ao redor do ponto — exigência do GetFeatureInfo (BBOX
    // tem que ser coerente com WIDTH/HEIGHT/X/Y para o MapServer interpretar).
    const point = map.latLngToContainerPoint([lat, lng]);
    const sw = map.containerPointToLatLng([point.x - 1, point.y + 1]);
    const ne = map.containerPointToLatLng([point.x + 1, point.y - 1]);
    const bbox = `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`;

    const tryUF = async (uf: SigefUF): Promise<{ uf: SigefUF; html: string } | null> => {
      const params = new URLSearchParams({
        SERVICE: 'WMS',
        VERSION: '1.1.1',
        REQUEST: 'GetFeatureInfo',
        LAYERS: sigefLayerForUF(uf),
        QUERY_LAYERS: sigefLayerForUF(uf),
        SRS: 'EPSG:4326',
        BBOX: bbox,
        WIDTH: '3',
        HEIGHT: '3',
        X: '1',
        Y: '1',
        INFO_FORMAT: SIGEF_INFO_FORMAT,
        FEATURE_COUNT: '1',
      });
      try {
        const resp = await fetch(`${SIGEF_PROXY_WMS}?${params.toString()}`);
        if (!resp.ok) return null;
        const html = await resp.text();
        return parseSigefInfoHtml(html) ? { uf, html } : null;
      } catch {
        return null;
      }
    };

    const results = await Promise.all([...sigefActiveUFs.current].map(tryUF));
    if (token !== sigefIdentifyToken.current) return null; // stale (outro clique chegou)
    const hit = results.find(r => r !== null) as { uf: SigefUF; html: string } | undefined;
    if (!hit) return null;

    const info = parseSigefInfoHtml(hit.html);
    if (!info) return null;

    return `
      <div class="pt-2 mt-2 border-t border-border space-y-1.5">
        <div class="font-semibold" style="color:hsl(28,90%,40%)">✓ Parcela SIGEF (INCRA) — ${hit.uf}</div>
        ${info.nome_area ? `<div><span class="text-muted-foreground">Nome:</span> ${info.nome_area}</div>` : ''}
        ${info.situacao ? `<div><span class="text-muted-foreground">Situação:</span> ${info.situacao}</div>` : ''}
        ${info.status ? `<div><span class="text-muted-foreground">Status:</span> ${info.status}</div>` : ''}
        ${info.matricula ? `<div><span class="text-muted-foreground">Matrícula:</span> ${info.matricula}</div>` : ''}
        ${info.codigo_imovel ? `<div><span class="text-muted-foreground">Cód. imóvel:</span> <span class="font-mono">${info.codigo_imovel}</span></div>` : ''}
        ${info.rt ? `<div><span class="text-muted-foreground">Resp. técnico:</span> ${info.rt}</div>` : ''}
        ${info.art ? `<div><span class="text-muted-foreground">ART:</span> ${info.art}</div>` : ''}
        ${info.data_aprovacao ? `<div><span class="text-muted-foreground">Aprovação:</span> ${info.data_aprovacao}</div>` : ''}
        ${info.parcela_codigo ? `<div class="text-[11px] text-muted-foreground italic">Cód. parcela: ${info.parcela_codigo}</div>` : ''}
      </div>`;
  };

  const renderGeometry = (d: MapData) => {
    const map = mapInstance.current;
    const lg = layerGroup.current;
    if (!map || !lg) return;
    lg.clearLayers();

    if (d.geojson) {
      // ITEM 6 — Camada 2 (Imóvel do cliente): verde #1D9E75, com preenchimento 50%, stroke 2.5px.
      const gj = L.geoJSON(d.geojson, {
        style: { color: '#1D9E75', weight: 2.5, opacity: 1, fillColor: '#1D9E75', fillOpacity: 0.5 },
      });
      // Tooltip com denominação + área (item 6).
      gj.eachLayer((layer: any) => {
        const feat = layer.feature as GeoJSON.Feature | undefined;
        const props = (feat?.properties ?? {}) as any;
        const denom = mainPropertyLabel || props.denomination || props.cod_imovel || 'Imóvel do cliente';
        const area = Number(props.area ?? 0);
        const tip = area > 0
          ? `<strong>${denom}</strong><br/>${area.toFixed(2)} ha`
          : `<strong>${denom}</strong>`;
        layer.bindTooltip(tip, { sticky: true, direction: 'top' });
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

  // Reaplica estilo dos polígonos vizinhos quando seleção OU lista de cadastrados muda.
  // Sem isso, o feedback visual (verde quando cadastrado, azul forte quando selecionado)
  // não acompanha as mudanças no painel.
  useEffect(() => {
    neighborLayersRef.current.forEach((layer, car) => {
      layer.setStyle(styleForNeighbor(car));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNeighbors, registeredNeighbors]);

  useEffect(() => {
    const map = mapInstance.current;
    const lg = neighborsLayer.current;
    if (!map || !lg) return;

    // União de CARs que devem aparecer no mapa
    const allCars = new Set<string>();
    registeredNeighbors?.forEach(c => allCars.add(sanitizeCar(c)));
    selectedNeighbors?.forEach(c => {
      const s = sanitizeCar(c);
      if (!registeredNeighbors?.has(s)) allCars.add(s);
    });

    // Remove layers de CARs que saíram dos dois conjuntos
    neighborLayersRef.current.forEach((_, car) => {
      if (!allCars.has(car)) {
        const layer = neighborLayersRef.current.get(car);
        if (layer) lg.removeLayer(layer as any);
        neighborLayersRef.current.delete(car);
        fetchedFeaturesRef.current.delete(car);
      }
    });

    if (allCars.size === 0) {
      lg.clearLayers();
      neighborLayersRef.current.clear();
      fetchedFeaturesRef.current.clear();
      neighborsFcRef.current = null;
      return;
    }

    const mainCar = sanitizeCar(
      (dataRef.current.geojson as any)?.properties?.cod_imovel ?? ''
    );

    // Só busca CARs ainda não carregados
    const newCars = [...allCars].filter(
      c => c !== mainCar && !fetchedFeaturesRef.current.has(c)
    );

    if (newCars.length === 0) {
      // Nada novo para buscar — só re-estilizar os existentes
      neighborLayersRef.current.forEach((layer, car) => {
        layer.setStyle(styleForNeighbor(car));
      });
      return;
    }

    const fetchAndAdd = async () => {
      for (const car of newCars) {
        try {
          const result = await fetchCarPolygon(car);
          if (result.ok !== false) {
            const feat: GeoJSON.Feature = {
              type: 'Feature',
              geometry: result.feature.geometry,
              properties: {
                cod_imovel: result.feature.cod_imovel,
                area: result.feature.area,
                municipio: result.feature.municipio,
                uf: result.feature.uf,
              },
            };
            fetchedFeaturesRef.current.set(car, feat);
          }
        } catch { /* CAR sem polígono no SICAR — ignora */ }
      }

      // Reconstrói FeatureCollection com todos os CARs ativos
      const features = [...allCars]
        .filter(c => c !== mainCar && fetchedFeaturesRef.current.has(c))
        .map(c => fetchedFeaturesRef.current.get(c)!);

      if (features.length === 0) return;

      const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
      renderNeighbors(fc, mainCar);
      neighborsFcRef.current = fc;
      if (!map.hasLayer(lg)) lg.addTo(map);
    };

    fetchAndAdd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registeredNeighbors, selectedNeighbors]);

  // F5 — Confrontantes em AMARELO (#EF9F27 fill 0.25, stroke #BA7517 1.5px).
  // Selecionado/cadastrado ganham realce mais forte para diferenciação visual.
  const styleForNeighbor = (car: string): L.PathOptions => {
    const sanitized = sanitizeCar(car);
    const isRegistered = registeredNeighborsRef.current.has(sanitized);
    const isSelected = selectedNeighborsRef.current.has(sanitized);

    if (isRegistered) {
      // Cadastrado em process_neighbors — AMARELO
      return {
        color: '#BA7517',
        weight: 2,
        fillColor: '#EF9F27',
        fillOpacity: 0.5,
        opacity: 1,
      };
    }

    if (isSelected) {
      // Listado no painel mas ainda não cadastrado — AZUL
      return {
        color: '#185FA5',
        weight: 2,
        fillColor: '#378ADD',
        fillOpacity: 0.4,
        opacity: 1,
      };
    }

    // Estado base — SICAR, não selecionado nem cadastrado
    return {
      color: '#F97316',
      weight: 1.5,
      fillColor: 'transparent',
      fillOpacity: 0,
      opacity: 0.85,
    };
  };

  const renderNeighbors = (fc: GeoJSON.FeatureCollection, mainCar: string) => {
    const lg = neighborsLayer.current;
    if (!lg) return;
    lg.clearLayers();
    neighborLayersRef.current.clear();
    neighborsFcRef.current = fc;
    L.geoJSON(fc, {
      onEachFeature: (feat, layer) => {
        const p = feat.properties as any;
        if (!p?.cod_imovel || p.cod_imovel === mainCar) return;
        const car = String(p.cod_imovel);
        const area = Number(p.area ?? 0);
        const municipio = String(p.municipio ?? '');
        const uf = String(p.uf ?? '');
        const sanitized = sanitizeCar(car);
        const path = layer as L.Path;
        path.setStyle(styleForNeighbor(car));
        neighborLayersRef.current.set(sanitized, path);

        const addBtnId = `neighbor-add-${sanitized.replace(/[^A-Za-z0-9]/g, '')}`;
        const toggleBtnId = `neighbor-toggle-${sanitized.replace(/[^A-Za-z0-9]/g, '')}`;
        const showAddBtn = !!onNeighborPick;
        const showToggleBtn = !!onNeighborToggleRef.current;

        // F7 — Mesmo se o CAR já existir como cadastrado, o popup SEMPRE
        // mostra o botão de adicionar. Isso permite reinserir após exclusão
        // (e cria registros novos sem checagem de "já cadastrado").
        const buildHtml = () => {
          const isRegistered = registeredNeighborsRef.current.has(sanitized);
          const isSelected = selectedNeighborsRef.current.has(sanitized);
          const toggleLabel = isSelected ? '☑ Desmarcar do painel' : '☐ Marcar no painel';
          const toggleClass = isSelected
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary text-secondary-foreground border border-border';
          const headerLabel = isRegistered
            ? '<span class="font-semibold text-success">✓ Já cadastrado (clique abaixo para readicionar)</span>'
            : '<span class="font-semibold">Imóvel vizinho (SICAR)</span>';
          const actionsHtml = `<div class="flex flex-wrap gap-1.5 pt-1">
                ${showToggleBtn ? `<button id="${toggleBtnId}" class="px-2 py-1 rounded ${toggleClass} text-xs">${toggleLabel}</button>` : ''}
                ${showAddBtn ? `<button id="${addBtnId}" class="px-2 py-1 rounded bg-secondary text-secondary-foreground text-xs border border-border">+ Adicionar como confrontante</button>` : ''}
              </div>`;
          return `
            <div class="text-xs space-y-1.5" style="min-width:240px">
              <div>${headerLabel}</div>
              <div><span class="text-muted-foreground">CAR:</span> <span class="font-mono break-all">${car}</span></div>
              <div><span class="text-muted-foreground">Área total:</span> ${area.toFixed(2)} ha</div>
              <div><span class="text-muted-foreground">Município:</span> ${municipio}${uf ? '/' + uf : ''}</div>
              ${actionsHtml}
            </div>`;
        };

        const wireButtons = () => {
          if (showToggleBtn) {
            document.getElementById(toggleBtnId)?.addEventListener('click', () => {
              onNeighborToggleRef.current?.(sanitized);
              (layer as any).closePopup?.();
            });
          }
          if (showAddBtn) {
            document.getElementById(addBtnId)?.addEventListener('click', () => {
              (layer as any).closePopup?.();
              onNeighborPick?.({ car, area, municipio, uf });
            });
          }
        };

        layer.bindPopup(buildHtml);
        layer.on('popupopen', (e: any) => {
          const popup = (layer as any).getPopup?.();
          const baseHtml = buildHtml();
          // Placeholder enquanto consulta SIGEF (se houver UF ativa).
          const sigefPending = sigefActiveUFs.current.size > 0;
          const pendingHtml = sigefPending
            ? `<div class="pt-2 mt-2 border-t border-border text-[11px] text-muted-foreground italic">Consultando SIGEF/INCRA…</div>`
            : '';
          popup?.setContent(baseHtml + pendingHtml);
          setTimeout(wireButtons, 0);

          if (!sigefPending) return;
          // Usa o latlng do clique (popup._latlng) para consultar GetFeatureInfo
          // exatamente sobre a parcela vizinha clicada.
          const latlng = e?.popup?._latlng ?? popup?._latlng;
          if (!latlng) return;
          identifySigefAtPoint(latlng.lat, latlng.lng).then((sigefHtml) => {
            // Garante que o popup ainda está aberto e é o mesmo (não houve outro clique).
            if (!(layer as any).isPopupOpen?.()) return;
            const finalHtml = baseHtml + (sigefHtml ?? `<div class="pt-2 mt-2 border-t border-border text-[11px] text-muted-foreground italic">Sem certificação SIGEF nesta parcela.</div>`);
            popup?.setContent(finalHtml);
            setTimeout(wireButtons, 0);
          });
        });
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
      onCarLoaded?.(result.feature.cod_imovel);

      // Ativa SICAR e SIGEF para a UF do imóvel após carregar o CAR com sucesso.
      const map = mapInstance.current;
      const sicar = sicarGroupRef.current;
      const sigef = sigefGroupRef.current;
      if (map && sicar && !map.hasLayer(sicar)) sicar.addTo(map);
      // SIGEF começa desligado mas é registrado no controle para o usuário ativar.

      // F6 — Removida a busca automática de TOUCHES neighbors após carregar o CAR.
      // Confrontantes só aparecem se cadastrados manualmente.

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

  /**
   * Identifica o imóvel SICAR sob o ponto clicado (se a UF puder ser inferida do
   * polígono atual ou do CAR vinculado). Mostra popup com CAR + área e oferece ação.
   */
  const identifyAtPoint = async (lat: number, lng: number) => {
    const map = mapInstance.current;
    if (!map) return;

    // Inferir UF: prioriza UF do polígono já carregado; fallback no CAR do processo.
    let uf: SicarUF | null = null;
    const currentCar = (dataRef.current.geojson as any)?.properties?.cod_imovel as string | undefined;
    if (currentCar) uf = parseCarUF(currentCar);
    if (!uf && carNumber) uf = parseCarUF(carNumber);
    if (!uf && carInput) uf = parseCarUF(carInput);
    if (!uf) {
      // Sem UF não dá pra consultar o WFS por ponto — popup informativo.
      L.popup({ closeButton: true, autoClose: true, closeOnClick: true })
        .setLatLng([lat, lng])
        .setContent(
          '<div class="text-xs">Selecione uma UF (busque por CAR primeiro) para identificar imóveis no clique.</div>',
        )
        .openOn(map);
      return;
    }

    setIdentifying(true);
    // F8 — Popup com botão de fechar visível e fechamento ao clicar fora.
    const loadingPopup = L.popup({ closeButton: true, autoClose: false, closeOnClick: true, maxWidth: 340 })
      .setLatLng([lat, lng])
      .setContent('<div class="text-xs">Consultando SICAR…</div>')
      .openOn(map);

    // SIGEF roda em paralelo — quando o popup do CAR estiver pronto,
    // anexamos o bloco SIGEF embaixo (ou nada, se não houver certificação).
    const sigefPromise = identifySigefAtPoint(lat, lng);

    try {
      const feat = await fetchFeatureAtPoint(uf, lat, lng);
      const sigefHtml = await sigefPromise;

      if (!feat) {
        // Sem CAR no ponto, mas pode haver SIGEF certificado — mostra só ele.
        if (sigefHtml) {
          loadingPopup.setContent(
            `<div class="text-xs space-y-1.5" style="min-width:260px">
               <div class="text-muted-foreground italic">Nenhum imóvel SICAR neste ponto.</div>
               ${sigefHtml}
             </div>`,
          );
        } else {
          loadingPopup.setContent(
            '<div class="text-xs">Nenhum imóvel SICAR ou SIGEF neste ponto.</div>',
          );
        }
        return;
      }
      const loadId = `sicar-load-${feat.cod_imovel}`;
      const neighborId = `sicar-neighbor-${feat.cod_imovel}`;
      const showNeighborBtn = !!onNeighborPick;
      const html = `
        <div class="text-xs space-y-1.5" style="min-width:260px">
          <div class="font-semibold">${feat.tipo_imovel || 'Imóvel SICAR'}</div>
          <div><span class="text-muted-foreground">CAR:</span> <span class="font-mono break-all">${feat.cod_imovel}</span></div>
          <div><span class="text-muted-foreground">Área total:</span> ${feat.area.toFixed(2)} ha</div>
          <div><span class="text-muted-foreground">Município:</span> ${feat.municipio}/${feat.uf}</div>
          ${sigefHtml ?? '<div class="pt-1 text-[11px] text-muted-foreground italic">Sem certificação SIGEF neste ponto.</div>'}
          <div class="flex flex-wrap gap-1.5 pt-2">
            <button id="${loadId}" class="px-2 py-1 rounded bg-primary text-primary-foreground text-xs">Carregar este imóvel</button>
            ${showNeighborBtn ? `<button id="${neighborId}" class="px-2 py-1 rounded bg-secondary text-secondary-foreground text-xs border border-border">+ Listar como confrontante</button>` : ''}
          </div>
        </div>`;
      loadingPopup.setContent(html);
      // Liga os botões depois que o popup é renderizado.
      setTimeout(() => {
        document.getElementById(loadId)?.addEventListener('click', () => {
          loadingPopup.close();
          setCarInput(feat.cod_imovel);
          loadCar(feat.cod_imovel);
        });
        if (showNeighborBtn) {
          document.getElementById(neighborId)?.addEventListener('click', () => {
            loadingPopup.close();
            // Extrai matrícula do bloco SIGEF se disponível no popup atual
            const sigefMatricula = (sigefHtml ?? '').match(
              /Matrícula:<\/span>\s*([^<]+)/
            )?.[1]?.trim() || undefined;
            onNeighborPick?.({
              car: feat.cod_imovel,
              area: feat.area,
              municipio: feat.municipio,
              uf: feat.uf,
              matricula: sigefMatricula,
            });
          });
        }
      }, 0);
    } finally {
      setIdentifying(false);
    }
  };

  // Mantém o ref de identifyAtPoint atualizado para o listener de click
  // (registrado uma vez no init do mapa).
  useEffect(() => {
    identifyRef.current = identifyAtPoint;
  });

  // Auto-carregar o polígono SICAR quando o processo já tem CAR vinculado
  // e o mapa ainda não exibe geometria. Evita re-busca em re-renders.
  useEffect(() => {
    if (!carNumber) return;
    if (dataRef.current.geojson) return;
    if (loadedCarsRef.current.has(carNumber)) return;
    loadedCarsRef.current.add(carNumber);
    setCarInput(carNumber);
    loadCar(carNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carNumber]);

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
    neighborsLayer.current?.clearLayers();
    neighborsFcRef.current = null;
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
    <div
      className={
        fullscreen
          ? 'fixed inset-0 z-[1000] bg-background p-4 space-y-3 overflow-auto'
          : 'space-y-3'
      }
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {sourceBadge()}
        <div className="flex items-center gap-2">
          {clickedCoord && (
            <span className="text-xs font-mono text-muted-foreground">
              {clickedCoord.lat.toFixed(6)}, {clickedCoord.lng.toFixed(6)}
            </span>
          )}
        </div>
      </div>

      <div className="relative">
        <div
          ref={mapRef}
          style={{ height: fullscreen ? 'calc(100vh - 180px)' : height, width: '100%' }}
          className="rounded-lg border border-border z-0"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setFullscreen(f => !f)}
          className="absolute top-2 left-2 z-[400] shadow-md"
          title={fullscreen ? 'Sair da tela cheia (Esc)' : 'Expandir mapa'}
        >
          {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          <span className="ml-1.5 hidden sm:inline">{fullscreen ? 'Reduzir' : 'Expandir'}</span>
        </Button>
        <div className="absolute top-2 right-14 z-[400] flex flex-col items-end gap-1.5">
          {neighborStatus !== 'idle' && (
            <>
              {neighborStatus === 'loading' && (
                <Badge className="bg-info/15 text-info border-info/30 shadow-md gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Buscando confrontantes…
                </Badge>
              )}
              {neighborStatus === 'done' && (
                <Badge className="bg-success/15 text-success border-success/30 shadow-md">
                  {neighborCount} confrontante{neighborCount === 1 ? '' : 's'} detectado{neighborCount === 1 ? '' : 's'}
                </Badge>
              )}
              {neighborStatus === 'empty' && (
                <Badge className="bg-muted text-muted-foreground border-border shadow-md">
                  Nenhum confrontante detectado
                </Badge>
              )}
              {neighborStatus === 'error' && (
                <Badge className="bg-destructive/15 text-destructive border-destructive/30 shadow-md">
                  Falha ao consultar SICAR
                </Badge>
              )}
            </>
          )}
          {/* SIGEF: agora é tile WMS via proxy. Status fica visível no controle de camadas. */}
        </div>
      </div>

      {!readOnly && (
        <>
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={handleClear}>
              <Trash2 className="w-4 h-4 mr-1.5" /> Limpar geometria
            </Button>
          </div>

          <Tabs defaultValue="car" className="w-full">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="car"><Search className="w-4 h-4 mr-1.5" />CAR</TabsTrigger>
              <TabsTrigger value="kml"><Upload className="w-4 h-4 mr-1.5" />KML</TabsTrigger>
              <TabsTrigger value="coords">Coords</TabsTrigger>
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
          </Tabs>
        </>
      )}
    </div>
  );
});

export default PropertyMap;
