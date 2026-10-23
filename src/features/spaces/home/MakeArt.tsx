/**
 * Small gray drawings of what each "Create" tile makes: a miniature chat,
 * page, canvas, drop zone and diff. Monochrome on purpose; shapes, not color, tell them apart.
 */
export function MakeArt({ kind }: { kind: "chat" | "note" | "drawing" | "file" | "code" }) {
  const sheet = "rounded-md border border-charcoal-border bg-charcoal-card";
  const line = "block h-1.5 rounded-full bg-cream-muted/25";
  const strong = "block h-1.5 rounded-full bg-cream-muted/50";
  if (kind === "chat")
    return (
      <span aria-hidden className={`${sheet} flex w-[62%] flex-col gap-1.5 p-2`}>
        <span className={`${line} w-[70%]`} />
        <span className={`${line} w-[45%]`} />
        <span className={`${strong} w-[55%] self-end`} />
      </span>
    );
  if (kind === "note")
    return (
      <span aria-hidden className={`${sheet} flex h-[78%] w-[42%] flex-col gap-1.5 p-2`}>
        <span className={`${strong} w-[60%]`} />
        <span className={line} />
        <span className={`${line} w-[85%]`} />
        <span className={`${line} w-[70%]`} />
      </span>
    );
  if (kind === "drawing")
    return (
      <svg
        aria-hidden
        viewBox="0 0 120 48"
        className="w-[70%] fill-none stroke-cream-muted/45 stroke-2"
      >
        <rect x="4" y="12" width="28" height="22" rx="5" />
        <path d="M32 23h14" />
        <circle cx="58" cy="23" r="11" className="stroke-cream-muted/70" />
        <path d="M69 23h14" />
        <rect x="84" y="14" width="30" height="18" rx="5" />
      </svg>
    );
  if (kind === "file")
    return (
      <span
        aria-hidden
        className="grid h-[70%] w-[46%] place-items-center rounded-md border border-dashed border-cream-muted/30"
      >
        <svg viewBox="0 0 24 24" className="size-6 fill-none stroke-cream-muted/60 stroke-[1.7]">
          <path d="M12 16V5M7 10l5-5 5 5M5 19h14" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  return (
    <span
      aria-hidden
      className={`${sheet} flex w-[66%] flex-col gap-0.5 px-2 py-1.5 font-mono text-[9px] leading-snug`}
    >
      <span className="text-cream-muted/60">src/app.ts</span>
      <span className="text-cream-muted/90">+ export()</span>
      <span className="text-cream-muted/40 line-through">- legacy()</span>
    </span>
  );
}
