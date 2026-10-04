// Small synthetic previews for Library cards and file previews.

export function DocThumb() {
  return (
    <svg viewBox="0 0 320 200" className="size-full" aria-hidden>
      <rect width="320" height="200" fill="#1d1d1d" />
      <rect x="96" y="18" width="128" height="170" rx="4" fill="#ecebe8" />
      <rect x="112" y="38" width="62" height="9" rx="2" fill="#2b2b2b" />
      {[60, 72, 84, 96, 116, 128, 140].map((y, index) => (
        <rect key={y} x="112" y={y} width={index % 3 === 2 ? 60 : 96} height="5" rx="2" fill="#b9b7b2" />
      ))}
    </svg>
  );
}

export function Wireframe({ className = "size-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 200" className={className} aria-hidden>
      <rect width="320" height="200" fill="#f4f3f1" />
      <rect x="16" y="14" width="60" height="8" rx="2" fill="#2b2b2b" />
      {[200, 230, 260].map((x) => (
        <rect key={x} x={x} y="15" width="22" height="6" rx="2" fill="#b0aeaa" />
      ))}
      <rect x="16" y="44" width="120" height="14" rx="2" fill="#3a3a3a" />
      <rect x="16" y="64" width="96" height="14" rx="2" fill="#3a3a3a" />
      <rect x="16" y="88" width="110" height="6" rx="2" fill="#b0aeaa" />
      <rect x="16" y="106" width="44" height="14" rx="3" fill="#2b2b2b" />
      <rect x="168" y="40" width="136" height="84" rx="4" fill="#d6d4cf" />
      {[16, 118, 220].map((x) => (
        <rect key={x} x={x} y="140" width="84" height="46" rx="4" fill="#e3e1dc" stroke="#cfcdc8" />
      ))}
    </svg>
  );
}
