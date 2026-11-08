import { useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import { useRun, useToast } from './lib';

// Small floating dev panel (bottom-right). Only admins see it; the server also refuses
// these actions from anyone who isn't an admin.
// To become an admin: open the site with ?dev (e.g. /?dev#/board), copy your id, and have
// Dominic run:  spacetime call nobody-missed make_admin '"<id>"' --server maincloud
export default function DevTools({ onInject, onAskReset }: { onInject?: () => void; onAskReset: () => void }) {
  const { identity } = useSpacetimeDB();
  const [admins] = useTable(tables.admin);
  const [storms] = useTable(tables.storm);
  const run = useRun();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [phoneName, setPhoneName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [sureClear, setSureClear] = useState(false);

  const me = identity?.toHexString() ?? '';
  const isAdmin = !!me && admins.some((a) => a.identityHex === me);
  const askedForDev = new URLSearchParams(window.location.search).has('dev');
  if (!isAdmin && !askedForDev) return null;

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
      {isAdmin ? (
        <>
          <p className="meta">Shared database: affects everyone.</p>
          <button className="btn" onClick={() => run((c) => c.reducers.seedHouseholds({ n: 1000 })).then(ok('Added 1,000 households'))}>
            Seed 1,000 households
          </button>
          {stormOn ? (
            <button className="btn danger" onClick={() => run((c) => c.reducers.endStorm({})).then(ok('Storm ended'))}>End storm</button>
          ) : (
            <button className="btn primary" onClick={() => run((c) => c.reducers.startStorm({})).then(ok('Storm started: alerts sent'))}>Start storm</button>
          )}
          <p className="meta">Add a team phone (already joined storm alerts):</p>
          <input className="devinput" placeholder="Name" value={phoneName} onChange={(e) => setPhoneName(e.target.value)} />
          <input className="devinput" placeholder="+12145550100" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input className="devinput" placeholder="City (blank = random)" value={city} onChange={(e) => setCity(e.target.value)} />
          <button
            className="btn"
            onClick={() =>
              run((c) => c.reducers.enrollHousehold({ name: phoneName, handle: phone, city, platform: 'imessage', spaceId: '', photonSenderId: '' }))
                .then((done) => { if (done) { toast('Team phone added', true); setPhone(''); setPhoneName(''); setCity(''); } })
            }
          >
            Add team phone
          </button>
          {onInject && <button className="btn" onClick={onInject}>Inject 2,000 reports</button>}
          <button className="btn danger" onClick={onAskReset}>Reset demo</button>
          {sureClear ? (
            <button className="btn danger solid" onClick={() => { setSureClear(false); void run((c) => c.reducers.clearHouseholds({})).then(ok('Households cleared')); }}>
              Really delete all households?
            </button>
          ) : (
            <button className="btn danger" onClick={() => setSureClear(true)}>Clear households</button>
          )}
        </>
      ) : (
        <>
          <p className="meta">Not an admin. Send Dominic this id:</p>
          <code className="devid">{me || 'connecting…'}</code>
        </>
      )}
    </div>
  );
}
