import { useMemo, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
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
      <StormReplies />
    </div>
  );
}

// Play a household's reply to the storm alert (no real phone needed).
function StormReplies() {
  const run = useRun();
  const toast = useToast();
  const [checkins] = useTable(tables.checkin);
  const [households] = useTable(tables.household);
  const [storms] = useTable(tables.storm);
  const [q, setQ] = useState('');
  const [custom, setCustom] = useState('');

  const storm = storms.find((s) => s.active);
  const rows = useMemo(() => {
    if (!storm) return [];
    const hh = new Map(households.map((h) => [h.id, h]));
    const needle = q.trim().toLowerCase();
    return checkins
      .filter((c) => c.stormId === storm.id && ['texted', 'retexted', 'called'].includes(c.state))
      .map((c) => ({ c, h: hh.get(c.householdId) }))
      .filter((x) => !needle || (x.h?.name ?? '').toLowerCase().includes(needle))
      .sort((a, b) => Number(b.h?.real ?? false) - Number(a.h?.real ?? false))
      .slice(0, 30);
  }, [checkins, households, storm, q]);

  const reply = (id: bigint, text: string) =>
    run((c) => c.reducers.simulateReply({ checkinId: id, text })).then((ok) => { if (ok) toast(`Replied “${text}”`, true); });

  return (
    <section className="checkinsim">
      <h2>Storm alert replies</h2>
      {!storm && <p className="meta">No active storm. An admin starts one from the Dev panel on the board.</p>}
      {storm && (
        <>
          <p className="meta">Households still waiting for a reply. Reply 1 = safe, 2 = needs help, or type what they would text.</p>
          <input placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
          <input placeholder="Custom reply, e.g. water is rising, mom is 80" value={custom} onChange={(e) => setCustom(e.target.value)} />
          {rows.length === 0 && <p className="meta">Nobody is waiting.</p>}
          {rows.map(({ c, h }) => (
            <div key={c.id.toString()} className="simrow">
              <span className="who">{h?.name ?? 'Unknown'}{h?.real ? ' (team phone)' : ''} · {c.state}</span>
              <button className="btn" onClick={() => reply(c.id, '1')}>Reply 1</button>
              <button className="btn" onClick={() => reply(c.id, '2')}>Reply 2</button>
              <button className="btn" disabled={!custom.trim()} onClick={() => reply(c.id, custom.trim())}>Send text</button>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
