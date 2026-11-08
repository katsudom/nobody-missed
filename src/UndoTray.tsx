// Bottom-left list of the Claims and Resolves you can still take back. A claimed case jumps to another
// tab, so Undo lives here instead of on its row. The module owns the 30 seconds: a row in undo_action
// means Undo is still open, and the tick removes it when time is up.
import { useMemo, useRef } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import { tsMs, useNow, useRun } from './lib';
import { personFor } from './policyholders';

// Mirrors UNDO_WINDOW in spacetimedb/src/rules.ts. Display only.
const UNDO_MS = 30_000;

export default function UndoTray() {
  const { identity } = useSpacetimeDB();
  const run = useRun();
  const now = useNow();
  const [undos] = useTable(tables.undoAction);
  const [requests] = useTable(tables.request);
  const [checkins] = useTable(tables.checkin);
  const [households] = useTable(tables.household);
  const me = identity?.toHexString();
  const busy = useRef(new Set<bigint>());

  const items = useMemo(() => {
    const reqs = new Map(requests.map((r) => [r.id, r]));
    const chks = new Map(checkins.map((c) => [c.id, c]));
    const byId = new Map(households.map((h) => [h.id, h]));
    const byHandle = new Map(households.map((h) => [h.handle, h]));
    const out = [];
    for (const u of undos) {
      if (u.actor.toHexString() !== me) continue;
      const row = u.caseKind === 'request' ? reqs.get(u.caseId) : chks.get(u.caseId);
      if (!row) continue;
      // Same check as the module: a Claim followed by a Resolve offers only the Resolve until that is undone.
      const open = u.action === 'claim' ? row.state === 'claimed' && row.claimedBy?.toHexString() === me : row.state === 'closed';
      if (!open) continue;
      const r = u.caseKind === 'request' ? reqs.get(u.caseId) : undefined;
      const name = r
        ? personFor(r, byHandle.get(r.victimHandle)).name
        : byId.get(chks.get(u.caseId)?.householdId ?? 0n)?.name ?? 'household';
      out.push({ id: u.id, verb: u.action === 'claim' ? 'Claimed' : 'Resolved', name, doneAt: tsMs(u.doneAt) });
    }
    return out.sort((a, b) => b.doneAt - a.doneAt);
  }, [undos, requests, checkins, households, me]);

  if (items.length === 0) return null;

  const undo = async (id: bigint) => {
    if (busy.current.has(id)) return;
    busy.current.add(id);
    await run((c) => c.reducers.undoCase({ undoId: id }));
    busy.current.delete(id);
  };

  return (
    <div className="undotray" role="status" aria-label="Actions you can undo">
      {items.map((x) => {
        const left = Math.min(30, Math.ceil((UNDO_MS - (now - x.doneAt)) / 1000));
        return (
          <div key={x.id.toString()} className="undoitem">
            <span className="undotext">{x.verb} <b>{x.name}</b></span>
            <button className="btn undobtn" onClick={() => undo(x.id)}>{left > 0 ? `Undo · ${left}s` : 'Undo'}</button>
          </div>
        );
      })}
    </div>
  );
}
