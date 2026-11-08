// Live severe-weather warnings from the National Weather Service (api.weather.gov).
// Free, no key, and CORS-open, so the browser calls it directly.
import { useEffect, useState } from 'react';

export type Hazard = 'tornado' | 'flood' | 'hurricane';

// Most urgent first: this order is also the display order.
const EVENTS: { event: string; hazard: Hazard }[] = [
  { event: 'Tornado Warning', hazard: 'tornado' },
  { event: 'Extreme Wind Warning', hazard: 'hurricane' }, // hurricane eyewall arriving
  { event: 'Hurricane Warning', hazard: 'hurricane' },
  { event: 'Storm Surge Warning', hazard: 'hurricane' },
  { event: 'Flash Flood Warning', hazard: 'flood' },
  { event: 'Flood Warning', hazard: 'flood' },
  { event: 'Coastal Flood Warning', hazard: 'flood' },
];

// State code(s) to watch, comma separated.
export const WEATHER_AREA: string = import.meta.env.VITE_WEATHER_AREA || 'TX';

const POLL_MS = 60_000;
const TIMEOUT_MS = 15_000;
const ALERTS_URL = `https://api.weather.gov/alerts/active?${new URLSearchParams({
  area: WEATHER_AREA,
  status: 'actual',
  message_type: 'alert,update',
  event: EVENTS.map((e) => e.event).join(','),
})}`;

export type WeatherAlert = {
  id: string;
  event: string;
  hazard: Hazard;
  area: string;
  headline: string;
  instruction: string;
  /** When the hazard ends. Null when the NWS hasn't given an end time (common for floods). */
  endsAt: number | null;
  /** When to stop showing it if we can't get a fresher answer. */
  expiresAt: number;
  /** GeoJSON shape for the map. Null for county-wide alerts: use `zones` for those. */
  geometry: { type: string; coordinates: unknown } | null;
  /** api.weather.gov zone URLs; each one serves its boundary as GeoJSON. */
  zones: string[];
};

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

// Throws on a malformed response so it can never be mistaken for "no warnings".
export function parseAlerts(json: unknown, now: number): WeatherAlert[] {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) throw new Error('Unexpected NWS response');
  const rank = (a: WeatherAlert) => EVENTS.findIndex((e) => e.event === a.event);
  return features
    .flatMap((f): WeatherAlert[] => {
      const p = f.properties;
      const hazard = EVENTS.find((e) => e.event === p.event)?.hazard;
      if (!hazard) return [];
      const ends = time(p.ends);
      const expires = Number.isNaN(ends) ? time(p.expires) : ends;
      return [{
        id: f.id ?? p.id,
        event: p.event,
        hazard,
        area: p.areaDesc ?? '',
        headline: p.headline ?? p.event,
        instruction: (p.instruction ?? '').replace(/\s*\n\s*/g, ' ').trim(),
        endsAt: Number.isNaN(ends) ? null : ends,
        expiresAt: Number.isNaN(expires) ? Infinity : expires,
        geometry: f.geometry ?? null,
        zones: p.affectedZones ?? [],
      }];
    })
    .filter((a) => a.expiresAt > now)
    .sort((a, b) => rank(a) - rank(b) || a.expiresAt - b.expiresAt);
}

export type WeatherState = {
  alerts: WeatherAlert[];
  status: 'loading' | 'ok' | 'error';
  /** Time of the last successful check. */
  updatedAt: number | null;
};

export function useWeatherAlerts(): WeatherState {
  const [state, setState] = useState<WeatherState>({ alerts: [], status: 'loading', updatedAt: null });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(ALERTS_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) throw new Error(`NWS responded ${res.status}`);
        const now = Date.now();
        const alerts = parseAlerts(await res.json(), now);
        if (alive) setState({ alerts, status: 'ok', updatedAt: now });
      } catch (err) {
        console.warn('Weather warnings fetch failed', err);
        // Keep what we had (minus anything now over) and let the UI say it may be out of date.
        if (alive) setState((s) => ({ ...s, status: 'error', alerts: s.alerts.filter((a) => a.expiresAt > Date.now()) }));
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  return state;
}
