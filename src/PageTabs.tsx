// Top-level pages. Hash links, same as the routing in App.tsx.
const PAGES = [
  { route: 'board', label: 'Check-ins' },
  { route: 'reports', label: 'Reports' },
  { route: 'disasters', label: 'Disasters' },
];

export default function PageTabs({ current }: { current: string }) {
  return (
    <nav className="tabs pagetabs" aria-label="Pages">
      {PAGES.map((p) => (
        <a key={p.route} href={`#/${p.route}`} className={`tab ${p.route === current ? 'on' : ''}`} aria-current={p.route === current ? 'page' : undefined}>
          {p.label}
        </a>
      ))}
    </nav>
  );
}
