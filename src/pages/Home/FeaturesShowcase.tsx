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
    <div className="flex items-center gap-2 text-xs text-text-muted flex-wrap">
      {searchProviders.map((p, i) => (
        <span
          key={p}
          className={`px-2.5 py-1.5 rounded-lg border transition-all duration-300 ${
            step === i ? "border-white/25 text-white bg-elevated" : "border-border bg-surface"
          }`}
        >
          {p}
        </span>
      ))}
      <span className={`transition-colors duration-300 ${step === 3 ? "text-white" : "text-text-muted"}`}>&rarr;</span>
      <span
        className={`px-2.5 py-1.5 rounded-lg border font-medium transition-all duration-300 ${
          step === 3 ? "border-white/25 text-white bg-elevated" : "border-border text-text bg-elevated"
        }`}
      >
        One index
      </span>
    </div>
  );
}

function OAuthPacket() {
  return (
    <div className="flex items-center text-xs text-text-muted gap-2">
      <div className="px-3 py-2 rounded-lg bg-surface border border-border shrink-0">
        <span className="text-text font-medium">Your device</span>
      </div>
      <div className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
        <span className="text-[10px]">Oauth</span>
        <div className="relative w-full h-3 flex items-center">
          <div className="absolute inset-x-0 border-t border-dashed border-border" />
          <div className="animate-oauth-packet w-1.5 h-1.5 rounded-full bg-zinc-400" />
        </div>
      </div>
      <div className="px-3 py-2 rounded-lg bg-surface border border-border shrink-0">
        <span>Cloud provider</span>
      </div>
    </div>
  );
}

const filePool = [
  "photos.zip", "report.pdf", "backup/", "video.mp4",
  "archive.tar", "assets/", "notes.docx", "data.csv", "exports/",
];

function TransferTrack({ speed, initialProgress, initialIdx }: { speed: number; initialProgress: number; initialIdx: number }) {
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
      <span className="text-text-muted w-28 truncate">{filePool[idx]}</span>
      <div className="flex-1 h-1.5 rounded-full bg-surface overflow-hidden">
        <div
          className="h-full rounded-full bg-text-muted"
          style={{ width: `${progress}%`, transition: progress < speed * 2 ? "none" : "width 50ms linear" }}
        />
      </div>
    </div>
  );
}

function DirectConnections() {
  const providers = ["Google Drive", "OneDrive", "Dropbox"];
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setActive((i) => (i + 1) % providers.length), 1200);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col gap-2 text-xs text-text-muted">
      {providers.map((provider, i) => (
        <div
          key={provider}
          className={`flex items-center gap-3 transition-opacity duration-400 ${
            active === i ? "opacity-100" : "opacity-35"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full shrink-0 transition-colors duration-300 ${
              active === i ? "bg-zinc-300" : "bg-zinc-700"
            }`}
          />
          <span className="w-24">{provider}</span>
          <div className="flex-1 border-t border-border" />
          <span className="text-[10px]">Connected</span>
        </div>
      ))}
    </div>
  );
}

export default function FeaturesShowcase() {
  return (
    <div className="flex flex-col gap-4">
      {/* Fast — full width */}
      <div className="glass-card rounded-2xl p-4 md:p-6 text-center relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[30%] left-0 w-20 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent animate-streak" />
          <div className="absolute top-[50%] left-0 w-32 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent animate-streak-2" />
          <div className="absolute top-[70%] left-0 w-16 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent animate-streak-3" />
        </div>
        <div className="relative">
          <h2 className="text-2xl md:text-3xl font-bold text-text tracking-tight mb-4">
            <span className="text-white">Fast</span>, zero bloat.
          </h2>
          <p className="text-text-muted max-w-xl mx-auto text-pretty">
            Misty is built for files streaming on demand. Files will sync in the backgro, no waiting. Search across every provider at once and never lose your place.
          </p>
        </div>
      </div>

      {/* 2-col row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card rounded-2xl p-4 md:p-6">
          <h3 className="text-xl font-bold text-text mb-3">Unified search</h3>
          <p className="text-text-muted text-pretty mb-5">
            One query across every connected provider. No more switching between tabs to find a file.
          </p>
          <SearchDiagram />
        </div>
        <div className="glass-card rounded-2xl p-4 md:p-6">
          <h3 className="text-xl font-bold text-text mb-3">Background transfers</h3>
          <p className="text-text-muted text-pretty mb-5">
            Moves and copies run quietly while you keep working. Large transfers don't block anything.
          </p>
          <div className="flex flex-col gap-2 text-xs">
            <TransferTrack speed={1.4} initialProgress={20} initialIdx={0} />
            <TransferTrack speed={2.2} initialProgress={55} initialIdx={1} />
            <TransferTrack speed={0.8} initialProgress={8}  initialIdx={2} />
          </div>
        </div>
      </div>

      {/* Secure — full width */}
      <div className="glass-card rounded-2xl p-4 md:p-6 text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-text tracking-tight mb-4">
          <span className="text-white">Secure</span> by design.
        </h2>
        <p className="text-text-muted max-w-xl mx-auto text-pretty">
          Your credentials never leave your machine. Direct connections over Oauth — no relay servers, no middlemen, no data we can see.
        </p>
      </div>

      {/* 2-col: Local-only + Direct connections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card rounded-2xl p-4 md:p-6">
          <h3 className="text-xl font-bold text-text mb-3">Local-only</h3>
          <p className="text-text-muted text-pretty mb-5">
            All processing happens on your device. Nothing is routed through our servers.
          </p>
          <OAuthPacket />
        </div>
        <div className="glass-card rounded-2xl p-4 md:p-6">
          <h3 className="text-xl font-bold text-text mb-3">Direct connections</h3>
          <p className="text-text-muted text-pretty mb-5">
            Every Api call goes straight from your machine to the provider. Optional Tailscale support for secure remote access.
          </p>
          <DirectConnections />
        </div>
      </div>
    </div>
  );
}
