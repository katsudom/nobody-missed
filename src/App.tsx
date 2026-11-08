import { useEffect, useState } from 'react';
import { useSpacetimeDB } from 'spacetimedb/react';
import Board from './Board';
import CheckinBoard from './CheckinBoard';
import VictimSim from './VictimSim';
import UndoTray from './UndoTray';
import { ToastProvider, useRun } from './lib';
import './styles.css';

const NAME_KEY = 'nobody-missed/responder-name';

function readName() {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}

// Hash routing (#/board = storm check-ins, #/reports, #/victim-sim) so it works on GitHub Pages with no server rewrites.
function useRoute() {
  const get = () => (window.location.hash.replace(/^#\/?/, '') || 'board');
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => setRoute(get());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

function NamePrompt({ onDone }: { onDone: (name: string) => void }) {
  const run = useRun();
  const [name, setName] = useState('');
  const submit = async () => {
    const n = name.trim();
    if (!n) return;
    if (await run((c) => c.reducers.registerResponder({ name: n }))) {
      try { localStorage.setItem(NAME_KEY, n); } catch { /* storage blocked: still works this session */ }
      onDone(n);
    }
  };
  return (
    <div className="modal">
      <div className="modalbox">
        <h1>Who's responding?</h1>
        <input
          autoFocus
          value={name}
          maxLength={40}
          placeholder="Your name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button className="btn big claim" onClick={submit}>Join the board</button>
      </div>
    </div>
  );
}

function Shell() {
  const { isActive } = useSpacetimeDB();
  const route = useRoute();
  const [name, setName] = useState(readName);
  const run = useRun();

  // Saved name: re-register on each connect so this browser's identity is known to the db.
  useEffect(() => {
    if (isActive && name) void run((c) => c.reducers.registerResponder({ name }));
  }, [isActive, name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (route === 'victim-sim') return <VictimSim />;
  return (
    <>
      {!isActive && <div className="conn">Connecting…</div>}
      {route === 'reports' ? <Board /> : <CheckinBoard />}
      <UndoTray />
      {!name && isActive && <NamePrompt onDone={setName} />}
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
