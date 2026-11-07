// Placeholder until the responder board (build step 4, SPEC §6).
import { tables } from './module_bindings';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';

function App() {
  const { isActive: connected } = useSpacetimeDB();
  const [requests] = useTable(tables.request);
  const sorted = [...requests].sort((a, b) => b.score - a.score);

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Nobody Missed</h1>
      <p>{connected ? 'Connected' : 'Connecting…'} · {requests.length} requests</p>
      <ul>
        {sorted.slice(0, 50).map((r) => (
          <li key={r.id.toString()}>
            [{r.tier}] {r.score} · {r.state} · {r.rawText}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;
