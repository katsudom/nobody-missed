// Disasters page: a Mapbox map of active National Weather Service alerts, with place search and
// category tabs. Reference view only: it reads a public feed and changes nothing in the database.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';
import 'mapbox-gl/dist/mapbox-gl.css';
import PageTabs from './PageTabs';

const TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN ?? '').trim();
const ALERTS_URL = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert&severity=Extreme,Severe';
const REFRESH_MS = 60_000;
const MAX_ROWS = 200;
const SEARCH_DELAY_MS = 250;
const ZONE_BATCH = 6; // boundaries fetched at once, to stay polite to the NWS API
const ZONE_TIMEOUT_MS = 15_000;
// NWS marine zones, by their code's area prefix (e.g. PKZ642 is off Alaska; AKZ is Alaska's land).
const MARINE_ZONE = /\/(AM|AN|GM|LC|LE|LH|LM|LO|LS|PH|PK|PM|PS|PZ|SL)Z\d+$/;

// Mapbox paint values can't read CSS variables. RED, AMBER, BLUE and WATER match --red, --amber, --blue and --bg.
const RED = '#ff3b6b';
const AMBER = '#ffc24b';
const BLUE = '#42d9ff';
const LAND = '#1a1240';
const WATER = '#0b0720';
const BORDER = '#43358a';
// Layer, paint property and color used to pull Mapbox's grey dark style toward the site's purple.
const BASE_TINT: [string, string, string][] = [
  ['land', 'background-color', LAND],
  ['landuse', 'fill-color', LAND],
  ['national-park', 'fill-color', LAND],
  ['water', 'fill-color', WATER],
  ['admin-0-boundary', 'line-color', BORDER],
  ['admin-1-boundary', 'line-color', BORDER],
];

interface Alert {
  id: string;
  event: string;
  areaDesc: string;
  severity: string;
  ends: string | null;
  tornado: boolean;
  geometry: Polygon | MultiPolygon | null;
  zones: string[]; // land zones only: the shape to draw when the alert has no geometry of its own
}

const CATEGORIES = [
  { key: 'all', label: 'All', match: (_: Alert) => true },
  { key: 'tornado', label: 'Tornadoes', match: (a: Alert) => a.tornado },
] as const;
type Category = (typeof CATEGORIES)[number]['key'];

interface Place { id: string; name: string; detail: string; center: [number, number] }

function byUrgency(a: Alert, b: Alert) {
  return Number(b.tornado) - Number(a.tornado) ||
    Number(b.severity === 'Extreme') - Number(a.severity === 'Extreme') ||
    a.event.localeCompare(b.event);
}

function useAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(ALERTS_URL, { signal, headers: { Accept: 'application/geo+json' } });
      if (!res.ok) throw new Error(`NWS ${res.status}`);
      const body = await res.json();
      const isOnLand = (f: any) => {
        const zones: string[] = f.properties.affectedZones ?? [];
        return !zones.length || zones.some((z) => !MARINE_ZONE.test(z));
      };
      const next: Alert[] = (body.features ?? []).filter(isOnLand).map((f: any) => ({
        id: String(f.properties.id ?? f.id),
        event: String(f.properties.event ?? 'Alert'),
        areaDesc: String(f.properties.areaDesc ?? ''),
        severity: String(f.properties.severity ?? ''),
        ends: f.properties.ends ?? f.properties.expires ?? null,
        tornado: /tornado/i.test(String(f.properties.event ?? '')),
        geometry: f.geometry ?? null,
        zones: (f.properties.affectedZones ?? []).filter((z: string) => !MARINE_ZONE.test(z)),
      }));
      setAlerts(next.sort(byUrgency));
      setUpdatedAt(new Date());
      setStatus('ok');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setStatus('error'); // keep the last good list on screen
    }
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    void load(ctl.signal);
    const timer = setInterval(() => void load(ctl.signal), REFRESH_MS);
    return () => { ctl.abort(); clearInterval(timer); };
  }, [load]);

  return { alerts, status, updatedAt, retry: () => { setStatus('loading'); void load(); } };
}

function polygonsOf(g: any): Position[][][] {
  if (g?.type === 'Polygon') return [g.coordinates];
  if (g?.type === 'MultiPolygon') return g.coordinates;
  if (g?.type === 'GeometryCollection') return g.geometries.flatMap(polygonsOf);
  return [];
}

// A failed lookup returns null, so it isn't remembered and the next refresh tries again.
async function fetchZone(url: string): Promise<[string, Position[][][]] | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/geo+json' }, signal: AbortSignal.timeout(ZONE_TIMEOUT_MS) });
    if (!res.ok) return null;
    return [url, polygonsOf((await res.json()).geometry)];
  } catch {
    return null;
  }
}

// Many alerts (hurricanes included) name forecast zones instead of carrying a shape: draw those zones' boundaries.
function useZoneShapes(alerts: Alert[]) {
  const [shapes, setShapes] = useState(new Map<string, Position[][][]>());
  const [loadingZones, setLoadingZones] = useState(false);
  const fetching = useRef(false);

  useEffect(() => {
    if (fetching.current) return; // anything new waits for the next refresh
    const todo = [...new Set(alerts.flatMap((a) => (a.geometry ? [] : a.zones)))].filter((z) => !shapes.has(z));
    if (!todo.length) return;
    fetching.current = true;
    setLoadingZones(true);
    void (async () => {
      for (let i = 0; i < todo.length; i += ZONE_BATCH) {
        const found = await Promise.all(todo.slice(i, i + ZONE_BATCH).map(fetchZone));
        setShapes((old) => new Map([...old, ...found.filter((x) => x !== null)]));
      }
      fetching.current = false;
      setLoadingZones(false);
    })();
  }, [alerts]); // eslint-disable-line react-hooks/exhaustive-deps

  const shaped = useMemo(() => alerts.map((a): Alert => {
    if (a.geometry) return a;
    const coordinates = a.zones.flatMap((z) => shapes.get(z) ?? []);
    return coordinates.length ? { ...a, geometry: { type: 'MultiPolygon', coordinates } } : a;
  }), [alerts, shapes]);

  return { alerts: shaped, loadingZones };
}

function boundsOf(g: Alert['geometry']): mapboxgl.LngLatBounds | null {
  if (!g) return null;
  const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
  const points = rings.flat() as [number, number][];
  if (!points.length) return null;
  return points.reduce((b, p) => b.extend(p), new mapboxgl.LngLatBounds(points[0], points[0]));
}

const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function endsLabel(iso: string | null) {
  if (!iso) return 'No end time given';
  return `Until ${new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
}

function PlaceSearch({ onPick }: { onPick: (p: Place) => void }) {
  const [q, setQ] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const text = q.trim();
    if (!TOKEN || text.length < 3) { setPlaces([]); setFailed(false); return; }
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(text)}&country=us&limit=5&access_token=${encodeURIComponent(TOKEN)}`;
        const res = await fetch(url, { signal: ctl.signal });
        if (!res.ok) throw new Error(`Mapbox ${res.status}`);
        const body = await res.json();
        setPlaces((body.features ?? []).map((f: any) => ({
          id: String(f.id),
          name: String(f.properties?.name ?? text),
          detail: String(f.properties?.place_formatted ?? ''),
          center: f.geometry.coordinates as [number, number],
        })));
        setActive(0);
        setFailed(false);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') { setPlaces([]); setFailed(true); }
      }
    }, SEARCH_DELAY_MS);
    return () => { ctl.abort(); clearTimeout(timer); };
  }, [q]);

  const pick = (p: Place) => { setQ(p.name); setOpen(false); onPick(p); };
  const showList = open && places.length > 0;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
    if (!showList) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % places.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + places.length) % places.length); }
    if (e.key === 'Enter') { e.preventDefault(); pick(places[active]); }
  };

  return (
    <div className="dzsearch">
      <input
        type="search"
        role="combobox"
        aria-label="Search for a place"
        aria-expanded={showList}
        aria-controls="dz-places"
        aria-autocomplete="list"
        aria-activedescendant={showList ? `dz-place-${active}` : undefined}
        aria-describedby={failed ? 'dz-search-error' : undefined}
        placeholder={TOKEN ? 'Search a city or address' : 'Search needs a Mapbox token'}
        disabled={!TOKEN}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKey}
      />
      {showList && (
        <ul id="dz-places" className="dzplaces" role="listbox" aria-label="Places">
          {places.map((p, i) => (
            <li
              key={p.id}
              id={`dz-place-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'on' : ''}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }} // before the input's blur closes the list
            >
              <b>{p.name}</b>
              <span>{p.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {failed && <p id="dz-search-error" className="dzerror" role="alert">Search isn't responding. Try again.</p>}
    </div>
  );
}

export default function DisastersMap() {
  const { alerts: feed, status, updatedAt, retry } = useAlerts();
  const { alerts, loadingZones } = useZoneShapes(feed);
  const [category, setCategory] = useState<Category>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const pin = useRef<mapboxgl.Marker | null>(null);

  const counts = useMemo(() => ({
    all: alerts.length,
    tornado: alerts.filter((a) => a.tornado).length,
  }), [alerts]);

  const shown = useMemo(() => {
    const match = CATEGORIES.find((c) => c.key === category)!.match;
    return alerts.filter(match);
  }, [alerts, category]);

  useEffect(() => {
    if (!TOKEN || !holder.current) return;
    let m: mapboxgl.Map;
    try {
      mapboxgl.accessToken = TOKEN;
      m = new mapboxgl.Map({
        container: holder.current,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [-98.5, 39.5],
        zoom: 3.4,
      });
    } catch {
      setMapError("This browser can't show the map because WebGL is unavailable.");
      return;
    }
    map.current = m;
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
    m.on('error', (e) => {
      const code = (e.error as { status?: number } | undefined)?.status;
      if (code === 401 || code === 403) setMapError('Mapbox rejected this token. Check VITE_MAPBOX_TOKEN.');
    });
    m.on('load', () => {
      // Guarded in case Mapbox renames a layer.
      for (const [layer, prop, color] of BASE_TINT) {
        if (m.getLayer(layer)) m.setPaintProperty(layer, prop as 'fill-color', color);
      }
      m.addSource('alerts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'alerts-fill', type: 'fill', source: 'alerts', paint: {
        'fill-color': ['case', ['get', 'tornado'], RED, AMBER],
        'fill-opacity': 0.28,
      } });
      m.addLayer({ id: 'alerts-line', type: 'line', source: 'alerts', paint: {
        'line-color': ['case', ['get', 'tornado'], RED, AMBER],
        'line-width': 1.5,
      } });
      m.on('click', 'alerts-fill', (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) setSelected(String(id));
      });
      m.on('mouseenter', 'alerts-fill', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'alerts-fill', () => { m.getCanvas().style.cursor = ''; });
      setMapReady(true);
    });
    return () => { setMapReady(false); m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!mapReady || !map.current) return;
    const features = shown.flatMap((a): Feature[] => a.geometry
      ? [{ type: 'Feature', geometry: a.geometry, properties: { id: a.id, tornado: a.tornado } }]
      : []);
    (map.current.getSource('alerts') as mapboxgl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }, [mapReady, shown]);

  useEffect(() => {
    if (!mapReady || !map.current?.getLayer('alerts-line')) return;
    map.current.setPaintProperty('alerts-line', 'line-width', ['case', ['==', ['get', 'id'], selected ?? ''], 4, 1.5]);
    map.current.setPaintProperty('alerts-fill', 'fill-opacity', ['case', ['==', ['get', 'id'], selected ?? ''], 0.5, 0.28]);
  }, [mapReady, selected]);

  const goToAlert = (a: Alert) => {
    setSelected(a.id);
    const b = boundsOf(a.geometry);
    if (b && map.current) map.current.fitBounds(b, { padding: 60, maxZoom: 10, animate: !calm() });
  };

  const goToPlace = (p: Place) => {
    if (!map.current) return;
    pin.current?.remove();
    pin.current = new mapboxgl.Marker({ color: BLUE }).setLngLat(p.center).addTo(map.current);
    map.current.flyTo({ center: p.center, zoom: 9, animate: !calm() });
  };

  const pickCategory = (c: Category) => { setCategory(c); setSelected(null); };
  const unmapped = shown.filter((a) => !a.geometry).length;
  const label = category === 'tornado' ? 'tornado alerts' : 'severe alerts';

  return (
    <div className="board">
      <header className="head">
        <div>
          <div className="eyebrow">Nobody Missed · Active disasters</div>
          <h1>Disaster Map</h1>
        </div>
        <PageTabs current="disasters" />
        <span className="spacer" />
        <span className="simtag" role="status">
          National Weather Service{updatedAt ? ` · updated ${updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
        </span>
      </header>

      <div className="cols">
        <section className="card" aria-label="Disaster map">
          <div className="qbar dzbar">
            <div className="tabs" role="tablist" aria-label="Disaster type">
              {CATEGORIES.map((c) => (
                <button key={c.key} role="tab" aria-selected={category === c.key} className={`tab ${category === c.key ? 'on' : ''}`} onClick={() => pickCategory(c.key)}>
                  {c.key === 'tornado' && <b className="dot" style={{ background: 'var(--red)' }} />}
                  {c.label} <span>{counts[c.key].toLocaleString()}</span>
                </button>
              ))}
            </div>
            <PlaceSearch onPick={goToPlace} />
          </div>
          <div className="dzframe">
            <div ref={holder} className="dzcanvas" />
            {!TOKEN && (
              <div className="dzcover">
                <b>The map needs a Mapbox token.</b>
                <span>Add VITE_MAPBOX_TOKEN to .env.local, then restart the dev server.</span>
              </div>
            )}
            {mapError && (
              <div className="dzcover" role="alert">
                <b>The map couldn't load.</b>
                <span>{mapError}</span>
              </div>
            )}
            {TOKEN && !mapError && (
              <div className="dzlegend">
                <span><b className="dot" style={{ background: 'var(--red)' }} />Tornado</span>
                <span><b className="dot" style={{ background: 'var(--amber)' }} />Other severe</span>
              </div>
            )}
          </div>
        </section>

        <section className="card" aria-label="Active alerts">
          <h2>Active {label}</h2>
          <div className="dzalerts" role="tabpanel">
            {status === 'loading' && alerts.length === 0 && <p className="empty">Loading alerts…</p>}
            {status === 'error' && (
              <div className="emptybox" role="alert">
                <b>{alerts.length ? 'Showing the last alerts we received.' : "Couldn't reach the National Weather Service."}</b>
                <button className="btn" onClick={retry}>Try again</button>
              </div>
            )}
            {status === 'ok' && shown.length === 0 && (
              <div className="emptybox">
                <b>No active {label} right now.</b>
                {category !== 'all' && <button className="btn" onClick={() => pickCategory('all')}>Show all alerts</button>}
              </div>
            )}
            {shown.slice(0, MAX_ROWS).map((a) => (
              <button key={a.id} className={`dzrow ${selected === a.id ? 'on' : ''}`} aria-pressed={selected === a.id} onClick={() => goToAlert(a)}>
                <span className="dzevent">
                  <b className="dot" style={{ background: a.tornado ? 'var(--red)' : 'var(--amber)' }} />
                  {a.event}
                </span>
                <span className="dzarea">{a.areaDesc}</span>
                <span className="meta">{endsLabel(a.ends)}{a.geometry ? '' : loadingZones ? ' · Loading map shape…' : ' · No map shape'}</span>
              </button>
            ))}
            {shown.length > MAX_ROWS && <p className="empty">Showing the first {MAX_ROWS} of {shown.length.toLocaleString()}.</p>}
            {unmapped > 0 && !loadingZones && <p className="meta">{unmapped.toLocaleString()} couldn't be drawn on the map.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
