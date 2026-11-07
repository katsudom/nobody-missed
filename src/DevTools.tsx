import { useState } from 'react';

// Small floating dev panel (bottom-right). Keeps demo-only controls off the main board.
// The server locks both actions to Dominic's terminal, so for everyone else they show an error.
export default function DevTools({ onInject, onAskReset }: { onInject: () => void; onAskReset: () => void }) {
  const [open, setOpen] = useState(false);

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
      <p className="meta">Shared database. Locked to Dominic for now.</p>
      <button className="btn" onClick={onInject}>Inject 2,000</button>
      <button className="btn danger" onClick={onAskReset}>Reset demo</button>
    </div>
  );
}
