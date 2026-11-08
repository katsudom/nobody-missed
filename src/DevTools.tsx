import { useState, type ReactNode } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import { useRun, useToast } from './lib';

// Small floating dev panel (bottom-right). Only admins see it; the server also refuses
// these actions from anyone who isn't an admin.
// To become an admin: open the site with ?dev (e.g. /?dev#/board), copy your id, and have
// Dominic run:  spacetime call nobody-missed make_admin '"<id>"' --server maincloud

type Tab = 'demo' | 'team' | 'reset';
const TAB_KEY = 'devtools.tab';

function readTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (t === 'demo' || t === 'team' || t === 'reset') return t;
  } catch { /* storage blocked */ }
  return 'demo';
}

// One action: a title and a short line under it saying what it does.
function Action({ title, hint, tone, onClick }: { title: string; hint?: string; tone?: 'primary' | 'danger' | 'confirm'; onClick: () => void }) {
  return (
    <button className={`devact${tone ? ` devact--${tone}` : ''}`} onClick={onClick}>
      <span className="devact__title">{title}</span>
      {hint && <span className="devact__hint">{hint}</span>}
    </button>
  );
}

function Section({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <section className="devsec">
      <h3 className="devsec__label">{label}</h3>
      {note && <p className="devsec__note">{note}</p>}
      {children}
    </section>
  );
}

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
  const [tab, setTabState] = useState<Tab>(readTab);
  const [sureResetPhones, setSureResetPhones] = useState(false);
  const [households] = useTable(tables.household);

  const me = identity?.toHexString() ?? '';
  // Local sandbox (`npm run sandbox:publish`): every action is open to anyone on this laptop.
  const sandbox = settings.find((x) => x.key === 'sandbox')?.value === 'on';
  const isAdmin = sandbox || (!!me && admins.some((a) => a.identityHex === me));
  const isTeammate = isAdmin || (!!me && teammates.some((x) => x.identityHex === me));
  const askedForDev = new URLSearchParams(window.location.search).has('dev');
  if (!isTeammate && !askedForDev) return null;

  const stormOn = storms.some((s) => s.active);
  const callsOn = settings.find((x) => x.key === 'calls')?.value === 'on';
  const joined = households.filter((h) => h.real).length;

  if (!open) {
    return (
      <button className="devpill" onClick={() => setOpen(true)} aria-label="Open dev tools">
        <span className={`devdot${stormOn ? ' is-live' : ''}`} aria-hidden />
        Dev
      </button>
    );
  }

  const ok = (msg: string) => (done: boolean) => { if (done) toast(msg, true); };
  const setTab = (t: Tab) => {
    setTabState(t);
    setSureResetPhones(false);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* storage blocked */ }
  };
  const tabs: { id: Tab; label: string }[] = [
    { id: 'demo', label: 'Demo' },
    { id: 'team', label: 'Team' },
    ...(isAdmin ? [{ id: 'reset' as Tab, label: 'Reset' }] : []),
  ];
  const shownTab = tabs.some((t) => t.id === tab) ? tab : 'demo';

  return (
    <div className="devpanel" role="dialog" aria-label="Dev tools">
      <div className="devhead">
        <strong>Dev tools</strong>
        <button className="devx" onClick={() => setOpen(false)} aria-label="Close dev tools">×</button>
      </div>

      <div className="devstatus" aria-label="Current state">
        {sandbox && <span className="devchip is-amber"><span className="devdot" aria-hidden />Local sandbox</span>}
        <span className={`devchip${stormOn ? ' is-red' : ''}`}><span className="devdot" aria-hidden />Storm {stormOn ? 'on' : 'off'}</span>
        <span className={`devchip${callsOn ? ' is-amber' : ''}`}><span className="devdot" aria-hidden />Calls {callsOn ? 'on' : 'off'}</span>
        <span className="devchip"><span className="devdot" aria-hidden />{joined} phone{joined === 1 ? '' : 's'}</span>
      </div>

      {isTeammate ? (
        <>
          <div className="devtabs" role="tablist" aria-label="Dev tools sections">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={shownTab === t.id}
                className={`devtabs__tab${shownTab === t.id ? ' is-on' : ''}${t.id === 'reset' ? ' is-danger' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="devbody" role="tabpanel">
            {shownTab === 'demo' && (
              <>
                <Section label="Storm" note={sandbox ? 'Only this laptop: nobody else sees it.' : 'Shared database: affects everyone.'}>
                  {stormOn ? (
                    <Action tone="danger" title="End storm" hint="Stops check-ins and turns calls off" onClick={() => run((c) => c.reducers.endStorm({})).then(ok('Storm ended'))} />
                  ) : (
                    <Action tone="primary" title="Start storm" hint={sandbox ? 'Fake households reply on their own' : 'Texts an alert to every team phone'} onClick={() => run((c) => c.reducers.startStorm({})).then(ok('Storm started in Richardson: alerts sent to every team phone'))} />
                  )}
                  {onInject && <Action title="Inject 2,000 reports" hint="Load test the board" onClick={onInject} />}
                </Section>
              </>
            )}

            {shownTab === 'team' && (
              <>
                <Section label="Team phones" note="Phones join by texting JOIN and their name (JOIN Dorothy) to the Photon number. Texting it again renames.">
                  <p className="devstat"><b>{joined}</b> joined now</p>
                </Section>
                <Section label="Phone calls" note={isAdmin ? 'Calls turn off by themselves when a storm ends.' : 'Only Dominic can turn calls on.'}>
                  {isAdmin ? (
                    callsOn ? (
                      <Action title="Turn calls off" onClick={() => run((c) => c.reducers.setCalls({ on: false })).then(ok('Calls off'))} />
                    ) : (
                      <Action tone="danger" title="Turn calls on" hint="Uses credits" onClick={() => run((c) => c.reducers.setCalls({ on: true })).then(ok('Calls on until the storm ends'))} />
                    )
                  ) : (
                    <p className="devstat"><b>{callsOn ? 'On' : 'Off'}</b></p>
                  )}
                </Section>
                {isAdmin && (
                  <Section label={`Teammates (${teammates.length})`} note="Paste the id from their Dev panel.">
                    <form
                      className="devrow"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!newMate.trim()) return;
                        void run((c) => c.reducers.addTeammate({ identityHex: newMate.trim() })).then((done) => { if (done) { toast('Teammate added', true); setNewMate(''); } });
                      }}
                    >
                      <input className="devinput" aria-label="Teammate's Dev id" placeholder="Teammate's Dev id" value={newMate} onChange={(e) => setNewMate(e.target.value)} />
                      <button className="devadd" type="submit" disabled={!newMate.trim()}>Add</button>
                    </form>
                  </Section>
                )}
                <Section label="Your id">
                  <code className="devid">{me || 'connecting…'}</code>
                </Section>
              </>
            )}

            {shownTab === 'reset' && isAdmin && (
              <Section label="Danger zone" note={sandbox ? 'Only this laptop: nobody else sees it.' : 'These change the shared database for everyone.'}>
                <Action tone="danger" title="Reset demo" hint="Clears storms, check-ins and reports. Keeps households" onClick={onAskReset} />
                {sureResetPhones ? (
                  <Action tone="confirm" title="Really forget all team phones?" hint="Everyone must text JOIN again" onClick={() => { setSureResetPhones(false); void run((c) => c.reducers.resetTeamPhones({})).then(ok('Team phones reset: text JOIN again')); }} />
                ) : (
                  <Action tone="danger" title="Reset team phones" hint="Asks again before it runs" onClick={() => setSureResetPhones(true)} />
                )}
              </Section>
            )}
          </div>
        </>
      ) : (
        <Section label="Not a teammate yet" note="Send Dominic this id:">
          <code className="devid">{me || 'connecting…'}</code>
        </Section>
      )}
    </div>
  );
}
