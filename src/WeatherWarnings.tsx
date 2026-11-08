import { WEATHER_AREA, type Hazard, type WeatherAlert, type WeatherState } from './weather';

const LABEL: Record<Hazard, string> = { tornado: 'Tornado', flood: 'Flood', hurricane: 'Hurricane' };

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function until(ms: number | null) {
  if (ms === null) return 'No end time yet';
  const sameDay = new Date(ms).toDateString() === new Date().toDateString();
  return `Until ${sameDay ? clock(ms) : new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
}

function Row({ a }: { a: WeatherAlert }) {
  return (
    <details className={`wxrow wx-${a.hazard}`}>
      <summary>
        <span className="wxtag">{LABEL[a.hazard]}</span>
        <span className="wxevent">{a.event}</span>
        <span className="wxarea">{a.area}</span>
        <span className="wxuntil">{until(a.endsAt)}</span>
      </summary>
      <div className="wxbody">
        <p>{a.headline}</p>
        <p className="wxmuted">{a.area}</p>
        {a.instruction && <p><b>What to do:</b> {a.instruction}</p>}
      </div>
    </details>
  );
}

// Keeps "we couldn't check" visibly different from "there is nothing to warn about".
export default function WeatherWarnings({ weather }: { weather: WeatherState }) {
  const { alerts, status, updatedAt } = weather;
  const checked = updatedAt ? `Last checked ${clock(updatedAt)}` : 'Not checked yet';
  const count = `${alerts.length} active ${alerts.length === 1 ? 'warning' : 'warnings'} in ${WEATHER_AREA}`;

  return (
    <section className="wx" aria-label="Weather warnings">
      <div className={`wxstatus ${status === 'error' ? 'bad' : alerts.length ? 'active' : ''}`} role="status">
        {status === 'loading' && 'Checking National Weather Service warnings…'}
        {status === 'error' && (
          <><b>Warnings may be out of date.</b> Can't reach the National Weather Service. {checked}.</>
        )}
        {status === 'ok' && (
          <>
            {alerts.length ? <b>{count}</b> : `No tornado, flood or hurricane warnings in ${WEATHER_AREA}`}
            <span className="wxmuted"> · National Weather Service · {checked}</span>
          </>
        )}
      </div>
      {alerts.length > 0 && (
        <div className="wxlist">{alerts.map((a) => <Row key={a.id} a={a} />)}</div>
      )}
    </section>
  );
}
