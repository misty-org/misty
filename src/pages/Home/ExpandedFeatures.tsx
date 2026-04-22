import { useEffect, useState } from "react";
import {
  HiOutlineArchiveBox,
  HiOutlineSparkles,
  HiOutlinePuzzlePiece,
  HiOutlineClock,
} from "react-icons/hi2";

const snapshots = [
  { id: "a1b2c3d", label: "Today, 9:41 AM", size: "2.3 GB" },
  { id: "e4f5g6h", label: "Yesterday, 11:02 PM", size: "2.3 GB" },
  { id: "i7j8k9l", label: "Apr 16, 8:15 AM", size: "2.1 GB" },
];

const SNAPSHOT_INTERVAL = 2200;

function SnapshotCycler() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setActive((i) => (i + 1) % snapshots.length), SNAPSHOT_INTERVAL);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="grid grid-cols-3 gap-2 w-full">
      {snapshots.map((snap, i) => {
        const isActive = i === active;
        return (
          <div
            key={snap.id}
            className={`relative px-4 py-3 rounded-xl border overflow-hidden transition-all duration-500 ${
              isActive ? "bg-surface border-zinc-700/60" : "bg-surface/40 border-border opacity-40"
            }`}
          >
            {isActive && (
              <div
                key={active}
                className="absolute inset-x-0 bottom-0 h-0.5 bg-zinc-500/60 origin-left animate-fill-bar"
              />
            )}
            <div className="flex items-center gap-2 text-xs">
              <HiOutlineClock className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-zinc-400" : "text-text-muted"}`} />
              <span className={`flex-1 truncate ${isActive ? "text-text" : "text-text-muted"}`}>{snap.label}</span>
              <span className={`px-1.5 py-0.5 rounded-full border text-[10px] shrink-0 ${
                i === 0 ? "border-zinc-700 text-zinc-400" : "border-border text-text-muted"
              }`}>
                {i === 0 ? "latest" : snap.id.slice(0, 7)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const conversations = [
  {
    q: "Which files changed since last week?",
    a: <>Found 4 modified files in <span className="text-text font-mono">~/projects/</span> since Apr 11…</>,
    thanks: "Perfect, that's what I needed!",
  },
  {
    q: "Find all PDFs larger than 10 MB",
    a: <>3 files found across <span className="text-text font-mono">Google Drive</span> and local storage</>,
    thanks: "Great, thanks!",
  },
  {
    q: "Move old photos to backup drive",
    a: <>Queued 847 files to <span className="text-text font-mono">/Volumes/Backup</span>…</>,
    thanks: "Awesome, much appreciated :)",
  },
];

type ChatPhase = "question" | "typing" | "answer" | "thanks";

function ChatCycler() {
  const [convIndex, setConvIndex] = useState(0);
  const [phase, setPhase] = useState<ChatPhase>("question");

  useEffect(() => {
    const timings: [ChatPhase, number][] = [
      ["question", 900],
      ["typing", 1100],
      ["answer", 1600],
      ["thanks", 1200],
    ];
    let step = 0;
    let t: number;
    function tick() {
      const [p, delay] = timings[step];
      setPhase(p);
      t = window.setTimeout(() => {
        step = (step + 1) % timings.length;
        if (step === 0) setConvIndex((i) => (i + 1) % conversations.length);
        tick();
      }, delay);
    }
    tick();
    return () => clearTimeout(t);
  }, []);

  const conv = conversations[convIndex];

  const showResponse = phase === "answer" || phase === "thanks";

  return (
    <div className="flex flex-col gap-2 text-xs mb-4">
      {/* User question */}
      <div className="self-end max-w-[80%] px-3 py-2 rounded-xl bg-elevated border border-border text-text">
        {conv.q}
      </div>

      {/* AI slot — typing or answer, same vertical space */}
      <div className="self-start max-w-[80%]">
        {phase === "typing" && (
          <div className="px-3 py-2 rounded-xl bg-surface border border-border animate-fade-in">
            <div className="flex gap-1 items-center h-3">
              <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
        {showResponse && (
          <div className="px-3 py-2 rounded-xl bg-surface border border-border text-text-muted animate-fade-in">
            {conv.a}
          </div>
        )}
        {phase === "question" && <div className="h-[29px]" />}
      </div>

      {/* Thanks — always takes space, opacity toggle so no layout shift */}
      <div className={`self-end max-w-[80%] px-3 py-2 rounded-xl bg-elevated border border-border text-text transition-opacity duration-300 ${phase === "thanks" ? "opacity-100" : "opacity-0"}`}>
        {conv.thanks}
      </div>
    </div>
  );
}

const extensions = ["Image optimizer", "PDF converter", "Bulk renamer"];

function ExtensionList() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setActive((i) => (i + 1) % extensions.length), 1500);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col gap-2 text-xs text-text-muted mb-4">
      {extensions.map((ext, i) => (
        <div
          key={ext}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all duration-300 ${
            active === i ? "bg-elevated border-white/15 text-text" : "bg-surface border-border"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-300 ${
            active === i ? "bg-zinc-300" : "bg-zinc-600"
          }`} />
          <span className="flex-1">{ext}</span>
          <span className="text-[10px] text-text-muted">extension</span>
        </div>
      ))}
    </div>
  );
}

export default function ExpandedFeatures() {
  return (
    <div className="flex flex-col gap-4">
      {/* Vault — full width */}
      <div className="glass-card rounded-2xl p-4 md:p-6 text-center">
        <div className="flex justify-center mb-4">
          <div className="w-10 h-10 rounded-lg bg-surface border border-border flex items-center justify-center">
            <HiOutlineArchiveBox className="w-5 h-5 text-text-muted" />
          </div>
        </div>
        <h2 className="text-2xl md:text-3xl font-bold text-text tracking-tight mb-3">
          <span className="text-white">Encrypted backups</span>, built in.
        </h2>
        <p className="text-text-muted text-pretty max-w-2xl mx-auto mb-2">
          Create restic-powered snapshots of any local or remote folder. Restore
          to any point in time, check integrity, and prune old copies — all from
          inside Misty. Passwords live in your OS keyring, never ours.
        </p>
        <p className="text-xs text-text-muted/60 mb-6">
          Powered by{" "}
          <a
            href="https://restic.net"
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-muted hover:text-white transition-colors"
          >
            restic
          </a>
        </p>
        <SnapshotCycler />
      </div>

      {/* 2-col: AI panel + Extensions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* AI panel */}
        <div className="glass-card rounded-2xl p-4 md:p-6 flex flex-col">
          <div className="w-10 h-10 rounded-lg bg-surface border border-border flex items-center justify-center mb-4">
            <HiOutlineSparkles className="w-5 h-5 text-text-muted" />
          </div>
          <h3 className="text-xl font-bold text-text mb-3">Ask your files anything.</h3>
          <p className="text-text-muted text-pretty mb-4">
            An integrated AI panel that understands your working directory.
            Query across your content, get answers, and take action — without
            leaving Misty.
          </p>
          <ChatCycler />
          <div className="flex justify-end mt-auto">
            <a href="/docs" className="text-xs text-text-muted hover:text-white transition-colors underline underline-offset-4">
              Learn more
            </a>
          </div>
        </div>

        {/* Extensions */}
        <div className="glass-card rounded-2xl p-4 md:p-6 flex flex-col">
          <div className="w-10 h-10 rounded-lg bg-surface border border-border flex items-center justify-center mb-4">
            <HiOutlinePuzzlePiece className="w-5 h-5 text-text-muted" />
          </div>
          <h3 className="text-xl font-bold text-text mb-3">Built to be extended.</h3>
          <p className="text-text-muted text-pretty mb-4">
            Launch custom workflows as isolated processes, embed panels into the
            UI, and build tools that treat your files as first-class citizens.
          </p>
          <ExtensionList />
          <div className="flex justify-end mt-auto">
            <a href="/docs" className="text-xs text-text-muted hover:text-white transition-colors underline underline-offset-4">
              Learn more
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
