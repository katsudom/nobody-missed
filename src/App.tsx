// Placeholder until the responder board (build step 4, SPEC §6).
import { useState } from 'react';
import { tables } from './module_bindings';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import Drawer from './board/Drawer';

function App() {
  const { isActive: connected } = useSpacetimeDB();
  const [requests] = useTable(tables.request);
  const [selectedId, setSelectedId] = useState<bigint | null>(null);
  const sorted = [...requests].sort((a, b) => b.score - a.score);
  const selected = selectedId === null ? undefined : requests.find((r) => r.id === selectedId);

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Nobody Missed</h1>
      <p>{connected ? 'Connected' : 'Connecting…'} · {requests.length} requests</p>
      <ul>
        {sorted.slice(0, 50).map((r) => (
          <li key={r.id.toString()} onClick={() => setSelectedId(r.id)} style={{ cursor: 'pointer' }}>
            [{r.tier}] {r.score} · {r.state} · {r.rawText}
          </li>
        ))}
      </ul>
      {selected && <Drawer key={selected.id.toString()} request={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

export default App;
