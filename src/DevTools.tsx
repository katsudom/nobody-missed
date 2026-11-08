import { useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import { useRun, useToast } from './lib';
import { setMode, useMode } from './mode';

// Small floating dev panel (bottom-right). Only admins see it; the server also refuses
// these actions from anyone who isn't an admin.
// To become an admin: open the site with ?dev (e.g. /?dev#/board), copy your id, and have
// Dominic run:  spacetime call nobody-missed make_admin '"<id>"' --server maincloud
export default function DevTools({ onInject, onAskReset }: { onInject?: () => void; onAskReset: () => void }) {
  const { identity } = useSpacetimeDB();
  const [admins] = useTable(tables.admin);
  const [teammates] = useTable(tables.teammate);
  const [settings] = useTable(tables.setting);
  const [newMate, setNewMate] = useState('');
  const [storms] = useTable(tables.storm);
  const run = useRun();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [sureClear, setSureClear] = useState(false);
  const [sureResetPhones, setSureResetPhones] = useState(false);
  const [households] = useTable(tables.household);
  const mode = useMode();

  const me = identity?.toHexString() ?? '';
  const isAdmin = !!me && admins.some((a) => a.identityHex === me);
  const isTeammate = isAdmin || (!!me && teammates.some((x) => x.identityHex === me));
  const askedForDev = new URLSearchParams(window.location.search).has('dev');
  if (!isTeammate && !askedForDev) return null;

  if (!open) {
    return (
      <button className="devpill" onClick={() => setOpen(true)} aria-label="Open dev tools">
        Dev
      </button>
    );
  }

  const stormOn = storms.some((s) => s.active);
  const ok = (msg: string) => (done: boolean) => { if (done) toast(msg, true); };

  return (
    <div className="devpanel" role="dialog" aria-label="Dev tools">
      <div className="devhead">
        <strong>Dev tools</strong>
        <button className="devx" onClick={() => setOpen(false)} aria-label="Close dev tools">×</button>
      </div>
      <div className="devmode" role="radiogroup" aria-label="What the boards show">
        <button role="radio" aria-checked={mode === 'real'} className={`devmode__opt${mode === 'real' ? ' is-on' : ''}`} onClick={() => setMode('real')}>
          Real phones
        </button>
        <button role="radio" aria-checked={mode === 'all'} className={`devmode__opt${mode === 'all' ? ' is-on' : ''}`} onClick={() => setMode('all')}>
          Fake data
        </button>
      </div>
      <p className="meta">
        {mode === 'real' ? "Showing only teammates' phones. This browser only." : 'Showing real phones plus fake households. This browser only.'}
      </p>
      {isTeammate ? (
        <>
          <p className="meta">Shared database: affects everyone.</p>
          <button className="btn" onClick={() => run((c) => c.reducers.seedHouseholds({ n: 100 })).then(ok('Added 100 fake households'))}>
            Seed 100 fake households
          </button>
          {stormOn ? (
            <button className="btn danger" onClick={() => run((c) => c.reducers.endStorm({})).then(ok('Storm ended'))}>End storm</button>
          ) : (
            <button className="btn primary" onClick={() => run((c) => c.reducers.startStorm({})).then(ok('Storm started in Richardson: alerts sent to every team phone'))}>Start storm</button>
          )}
          <p className="meta">
            Phone calls: <b>{settings.find((x) => x.key === 'calls')?.value === 'on' ? 'ON (uses credits)' : 'off'}</b>
            {isAdmin ? '' : ' · only Dominic can turn calls on'}
          </p>
          <p className="meta">
            Team phones join by texting JOIN to the Photon number. Joined now: {households.filter((h) => h.real).length}
          </p>
          {onInject && <button className="btn" onClick={onInject}>Inject 2,000 reports</button>}
          {isAdmin && (
            <>
              <p className="meta">Dominic only:</p>
              {settings.find((x) => x.key === 'calls')?.value === 'on' ? (
                <button className="btn" onClick={() => run((c) => c.reducers.setCalls({ on: false })).then(ok('Calls off'))}>Turn calls off</button>
              ) : (
                <button className="btn danger" onClick={() => run((c) => c.reducers.setCalls({ on: true })).then(ok('Calls on until the storm ends'))}>
                  Turn calls on (uses credits)
                </button>
              )}
              <input className="devinput" placeholder="Teammate's Dev id" value={newMate} onChange={(e) => setNewMate(e.target.value)} />
              <button
                className="btn"
                onClick={() => run((c) => c.reducers.addTeammate({ identityHex: newMate })).then((done) => { if (done) { toast('Teammate added', true); setNewMate(''); } })}
              >
                Add teammate ({teammates.length})
              </button>
              {sureResetPhones ? (
                <button className="btn danger solid" onClick={() => { setSureResetPhones(false); void run((c) => c.reducers.resetTeamPhones({})).then(ok('Team phones reset: text JOIN again')); }}>
                  Really forget all team phones?
                </button>
              ) : (
                <button className="btn danger" onClick={() => setSureResetPhones(true)}>Reset team phones</button>
              )}
              <button className="btn danger" onClick={onAskReset}>Reset demo</button>
              {sureClear ? (
                <button className="btn danger solid" onClick={() => { setSureClear(false); void run((c) => c.reducers.clearHouseholds({})).then(ok('Households cleared')); }}>
                  Really delete all households?
                </button>
              ) : (
                <button className="btn danger" onClick={() => setSureClear(true)}>Clear households</button>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <p className="meta">Not a teammate yet. Send Dominic this id:</p>
          <code className="devid">{me || 'connecting…'}</code>
        </>
      )}
    </div>
  );
}
