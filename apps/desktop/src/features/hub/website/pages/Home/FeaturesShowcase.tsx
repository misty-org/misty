import { useEffect, useRef, useState } from "react";

const searchProviders = ["Google Drive", "OneDrive", "Dropbox"];

function SearchDiagram() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const durations = [700, 700, 700, 1400];
    let current = 0;
    let t: number;
    function tick() {
      setStep(current);
      t = window.setTimeout(() => {
        current = (current + 1) % 4;
        tick();
      }, durations[current]);
    }
    tick();
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
      {searchProviders.map((p, i) => (
        <span
          key={p}
          className={`rounded-lg border px-2.5 py-1.5 transition-all duration-300 ${
            step === i ? "border-white/25 bg-elevated text-white" : "border-border bg-surface"
          }`}
        >
          {p}
        </span>
      ))}
      <span className={`transition-colors duration-300 ${step === 3 ? "text-white" : "text-text-muted"}`}>
        &rarr;
      </span>
      <span
        className={`rounded-lg border px-2.5 py-1.5 font-medium transition-all duration-300 ${
          step === 3 ? "border-white/25 bg-elevated text-white" : "border-border bg-elevated text-text"
        }`}
      >
        One index
      </span>
    </div>
  );
}

const filePool = [
  "photos.zip", "report.pdf", "backup/", "video.mp4",
  "archive.tar", "assets/", "notes.docx", "data.csv", "exports/",
];

function TransferTrack({
  speed,
  initialProgress,
  initialIdx,
}: {
  speed: number;
  initialProgress: number;
  initialIdx: number;
}) {
  const [progress, setProgress] = useState(initialProgress);
  const [idx, setIdx] = useState(initialIdx);
  const progressRef = useRef(initialProgress);

  useEffect(() => {
    const t = setInterval(() => {
      progressRef.current += speed;
      if (progressRef.current >= 100) {
        progressRef.current = 0;
        setIdx((i) => (i + 3) % filePool.length);
      }
      setProgress(progressRef.current);
    }, 50);
    return () => clearInterval(t);
  }, [speed]);

  return (
    <div className="flex items-center gap-3">
      <span className="w-28 truncate text-text-muted">{filePool[idx]}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
        <div
          className="h-full rounded-full bg-text-muted"
          style={{ width: `${progress}%`, transition: progress < speed * 2 ? "none" : "width 50ms linear" }}
        />
      </div>
    </div>
  );
}

function OAuthPacket() {
  return (
    <div className="flex items-center gap-2 text-xs text-text-muted">
      <div className="shrink-0 rounded-lg border border-border bg-surface px-3 py-2">
        <span className="font-medium text-text">Your device</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
        <span className="text-[10px]">Oauth</span>
        <div className="relative flex h-3 w-full items-center">
          <div className="absolute inset-x-0 border-t border-dashed border-border" />
          <div className="animate-oauth-packet h-1.5 w-1.5 rounded-full bg-zinc-400" />
        </div>
      </div>
      <div className="shrink-0 rounded-lg border border-border bg-surface px-3 py-2">
        <span>Cloud provider</span>
      </div>
    </div>
  );
}

export default function FeaturesShowcase() {
  return (
    <div className="flex flex-col gap-4">
      <div className="glass-card grid grid-cols-1 overflow-hidden rounded-2xl md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="p-5 md:p-8">
          <div className="flex h-full flex-col justify-center rounded-xl bg-surface/20 p-5 text-left md:p-6">
            <h2 className="mb-4 text-2xl font-bold tracking-tight text-text md:text-3xl">
              <span className="text-white">Fast</span>, zero bloat.
            </h2>
            <p className="mb-6 text-pretty text-text-muted">
              Search, browse, and move files without the interface getting in your way.
            </p>
            <div className="divide-y divide-border/70 rounded-xl border border-border/60 bg-surface/10">
              <div className="px-4 py-4 md:px-5">
                <h3 className="mb-2 text-xl font-bold text-text">Unified search</h3>
                <p className="mb-4 text-sm text-text-muted">One query across everything you connect.</p>
                <SearchDiagram />
              </div>
              <div className="px-4 py-4 md:px-5">
                <h3 className="mb-2 text-xl font-bold text-text">Background transfers</h3>
                <p className="mb-4 text-sm text-text-muted">Transfers keep running while you keep working.</p>
                <div className="flex flex-col gap-2 text-xs">
                  <TransferTrack speed={1.4} initialProgress={20} initialIdx={0} />
                  <TransferTrack speed={2.2} initialProgress={55} initialIdx={1} />
                  <TransferTrack speed={0.8} initialProgress={8} initialIdx={2} />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="border-t border-border/70 bg-[#0f0d0c] p-5 md:border-l md:border-t-0 md:p-8">
          <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-border bg-surface/15 p-5">
            <div className="text-center">
              <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-text-muted/70">
                Screenshot Area
              </p>
              <p className="text-sm text-text-muted">Reserved for fast workflow preview</p>
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card grid grid-cols-1 overflow-hidden rounded-2xl md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="border-b border-border/70 bg-[#0f0d0c] p-5 md:border-b-0 md:border-r md:p-8">
          <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-border bg-surface/15 p-5">
            <div className="text-center">
              <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-text-muted/70">
                Screenshot Area
              </p>
              <p className="text-sm text-text-muted">Reserved for security and auth preview</p>
            </div>
          </div>
        </div>
        <div className="p-5 md:p-8">
          <div className="flex h-full flex-col justify-center rounded-xl bg-surface/20 p-5 text-left md:p-6">
            <h2 className="mb-4 text-2xl font-bold tracking-tight text-text md:text-3xl">
              <span className="text-white">Secure</span> by design.
            </h2>
            <p className="mb-6 text-pretty text-text-muted">
              Your accounts connect directly, and your file contents stay out of our hands.
            </p>
            <div className="divide-y divide-border/70 rounded-xl border border-border/60 bg-surface/10">
              <div className="px-4 py-4 md:px-5">
                <a
                  href="/docs/introduction"
                  className="text-xs text-text-muted underline underline-offset-4 transition-colors hover:text-white"
                >
                  Learn more about how Misty works
                </a>
              </div>
              <div className="px-4 py-4 md:px-5">
                <p className="mb-4 text-[11px] uppercase tracking-[0.18em] text-text-muted/70">
                  Authentication flow
                </p>
                <OAuthPacket />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
