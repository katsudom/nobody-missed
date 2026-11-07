import { useState } from 'react';
import { useRun, useToast } from './lib';
import { HOLDERS, ISSUES } from './policyholders';

export default function VictimSim() {
  const run = useRun();
  const toast = useToast();
  const [handle, setHandle] = useState('+15550000001');
  const [text, setText] = useState('');

  const send = async (kind: 'new' | 'reply') => {
    const body = text.trim();
    if (!body || !handle.trim()) return;
    const ok = await run((c) =>
      kind === 'new'
        ? c.reducers.submitRequest({
            victimHandle: handle.trim(),
            spaceId: `sim-${handle.trim()}`,
            photonSenderId: 'sim',
            platform: 'sim',
            rawText: body,
          })
        : c.reducers.victimReplied({ victimHandle: handle.trim(), text: body })
    );
    if (ok) {
      toast(kind === 'new' ? 'Request submitted' : 'Reply sent');
      setText('');
    }
  };

  return (
    <div className="sim">
      <h1>Victim simulator</h1>
      <p className="meta">Dev only. Acts as a victim texting the line. Typed messages stay “new” until the bridge is running.</p>
      <label>Fake policyholder (fills handle and message)</label>
      <select
        defaultValue=""
        onChange={(e) => {
          const h = HOLDERS.find((x) => x.handle === e.target.value);
          if (h) { setHandle(h.handle); setText(h.text); }
        }}
      >
        <option value="">Pick one…</option>
        {HOLDERS.map((h) => (
          <option key={h.handle} value={h.handle}>{h.name} · {ISSUES.find((i) => i.key === h.issue)?.label}</option>
        ))}
      </select>
      <label>Victim handle (phone or email)</label>
      <input value={handle} onChange={(e) => setHandle(e.target.value)} />
      <label>Message</label>
      <textarea
        rows={5}
        value={text}
        placeholder="Mom is 82, on oxygen, power's out."
        onChange={(e) => setText(e.target.value)}
      />
      <div className="actions">
        <button className="btn big claim" onClick={() => send('new')}>Submit request</button>
        <button className="btn big" onClick={() => send('reply')}>Send as reply</button>
      </div>
    </div>
  );
}
