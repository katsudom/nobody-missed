import { useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import type { Mode } from './Board';

// Small floating dev panel (bottom-right). Only admins see it; the server also refuses
// Inject and Reset from anyone who isn't an admin.
// To become an admin: open the site with ?dev (e.g. /?dev#/board), copy your id, and have
// Dominic run:  spacetime call nobody-missed make_admin '"<id>"' --server maincloud
export default function DevTools({ mode, onMode, onInject, onAskReset }: {
  mode: Mode; onMode: (m: Mode) => void; onInject: () => void; onAskReset: () => void;
}) {
  const { identity } = useSpacetimeDB();
  const [admins] = useTable(tables.admin);
  const [open, setOpen] = useState(false);

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

  return (
    <div className="devpanel" role="dialog" aria-label="Dev tools">
      <div className="devhead">
        <strong>Dev tools</strong>
        <button className="devx" onClick={() => setOpen(false)} aria-label="Close dev tools">×</button>
      </div>
      <div className="devmode" role="radiogroup" aria-label="What the board shows">
        <button role="radio" aria-checked={mode === 'real'} className={`devmode__opt${mode === 'real' ? ' is-on' : ''}`} onClick={() => onMode('real')}>
          Real phones
        </button>
        <button role="radio" aria-checked={mode === 'all'} className={`devmode__opt${mode === 'all' ? ' is-on' : ''}`} onClick={() => onMode('all')}>
          Fake data too
        </button>
      </div>
      <p className="meta">
        {mode === 'real' ? "Only texts from teammates' iPhones. This browser only." : 'Real texts plus victim-sim and injected cases. This browser only.'}
      </p>
      {isAdmin ? (
        <>
          <p className="meta">Shared database: affects everyone.</p>
          <button className="btn" onClick={onInject}>Inject 2,000</button>
          <button className="btn danger" onClick={onAskReset}>Reset demo</button>
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
