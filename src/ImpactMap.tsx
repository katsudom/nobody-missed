import { memo } from 'react';
import { mapPos } from './policyholders';

export type Dot = { id: bigint; color: string; big: boolean };

// Simulated storm map: positions are fake (derived from the request id), the backend has no locations.
export default memo(function ImpactMap({ dots, selectedId, onPick }: { dots: Dot[]; selectedId?: bigint; onPick: (id: bigint) => void }) {
  const W = 420, H = 260;
  return (
    <svg className="map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Simulated impact zone map">
      <defs>
        <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
          <path d="M28 0H0V28" fill="none" stroke="#1d1d21" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />
      <path d="M0 150 C 90 120, 150 190, 230 150 S 360 130, 420 160" fill="none" stroke="#1b2740" strokeWidth="14" />
      <polygon points="50,60 250,30 385,95 340,215 150,235 40,170" fill="#ff4d5e14" stroke="#ff4d5e" strokeDasharray="6 5" />
      {dots.map((d) => {
        const [px, py] = mapPos(d.id);
        const x = 60 + px * 310, y = 45 + py * 175;
        return (
          <circle key={d.id.toString()} cx={x} cy={y} r={d.big ? 5.5 : 3.5} fill={d.color} onClick={() => onPick(d.id)} style={{ cursor: 'pointer' }} />
        );
      })}
      {selectedId !== undefined && (() => {
        const [px, py] = mapPos(selectedId);
        const x = 60 + px * 310, y = 45 + py * 175;
        return <circle cx={x} cy={y} r="11" fill="none" stroke="#fff" strokeWidth="2" />;
      })()}
    </svg>
  );
});
