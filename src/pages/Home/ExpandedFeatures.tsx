import { useEffect, useState } from "react";
import { HiOutlineSparkles } from "react-icons/hi2";

const conversations = [
  {
    q: "Which files changed since last week?",
    a: <>Found 4 modified files in <span className="text-text font-mono">~/projects/</span> since Apr 11…</>,
    thanks: "Perfect, that's what I needed!",
  },
  {
    q: "Find all Pdfs larger than 10 MB",
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
    <div className="mb-4 flex h-[210px] flex-col gap-2 text-xs">
      <div className="self-end max-w-[80%] rounded-xl border border-border bg-elevated px-3 py-2 text-text">
        {conv.q}
      </div>

      <div className="self-start min-h-[52px] max-w-[80%]">
        {phase === "typing" && (
          <div className="animate-fade-in rounded-xl border border-border bg-surface px-3 py-2">
            <div className="flex h-3 items-center gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:300ms]" />
            </div>
          </div>
        )}
        {showResponse && (
          <div className="animate-fade-in rounded-xl border border-border bg-surface px-3 py-2 text-text-muted">
            {conv.a}
          </div>
        )}
        {phase === "question" && <div className="h-[52px]" />}
      </div>

      <div
        className={`self-end mt-auto max-w-[80%] rounded-xl border border-border bg-elevated px-3 py-2 text-text transition-opacity duration-300 ${phase === "thanks" ? "opacity-100" : "opacity-0"}`}
      >
        {conv.thanks}
      </div>
    </div>
  );
}

export default function ExpandedFeatures() {
  return (
    <div className="flex flex-col gap-4">
      <div className="glass-card grid grid-cols-1 overflow-hidden rounded-2xl md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="p-5 md:p-8">
          <div className="flex h-full flex-col justify-center rounded-xl bg-surface/20 p-5 text-left md:p-6">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface">
              <HiOutlineSparkles className="h-5 w-5 text-text-muted" />
            </div>
            <h2 className="mb-3 text-2xl font-bold tracking-tight text-text md:text-3xl">
              Smart and context aware.
            </h2>
            <p className="mb-6 text-pretty text-text-muted">
              Answers stay grounded in the files and workspace already in front of you.
            </p>
            <div className="divide-y divide-border/70 rounded-xl border border-border/60 bg-surface/10">
              <div className="px-4 py-4 md:px-5">
                <h3 className="mb-3 text-xl font-bold text-text">Ask your files anything.</h3>
                <p className="text-pretty text-text-muted">
                  Search, summarize, and act without leaving the current view.
                </p>
              </div>
              <div className="px-4 py-4 md:px-5">
                <ChatCycler />
              </div>
              <div className="flex justify-end px-4 py-4 md:px-5">
                <a
                  href="/features"
                  className="text-xs text-text-muted underline underline-offset-4 transition-colors hover:text-white"
                >
                  Learn more
                </a>
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
              <p className="text-sm text-text-muted">Reserved for AI workspace preview</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
