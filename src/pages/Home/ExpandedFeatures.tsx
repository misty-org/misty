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

export default function ExpandedFeatures() {
  return (
    <div className="flex flex-col gap-4">
      {/* Vault — full width */}
      <div className="glass-card rounded-2xl p-10 md:p-14">
        <div className="w-10 h-10 rounded-lg bg-surface border border-border flex items-center justify-center mb-5">
          <HiOutlineArchiveBox className="w-5 h-5 text-text-muted" />
        </div>
        <h2 className="text-2xl md:text-3xl font-bold text-text tracking-tight mb-3">
          <span className="text-white">Encrypted backups</span>, built in.
        </h2>
        <p className="text-text-muted text-pretty max-w-2xl mb-8">
          Create restic-powered snapshots of any local or remote folder. Restore
          to any point in time, check integrity, and prune old copies — all from
          inside Misty. Passwords live in your OS keyring, never ours.
        </p>
        <p className="text-xs text-text-muted/60 -mt-6 mb-8">
          Backup engine powered by{" "}
          <a
            href="https://restic.net"
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-muted hover:text-white transition-colors"
          >
            restic
          </a>
        </p>
        {/* Snapshot list */}
        <div className="flex flex-col gap-2 text-sm max-w-md">
          {snapshots.map((snap, i) => (
            <div
              key={snap.id}
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface border border-border"
            >
              <HiOutlineClock className="w-4 h-4 text-text-muted shrink-0" />
              <span className="flex-1 text-text-muted">{snap.label}</span>
              <span className="text-xs text-text-muted font-mono">{snap.size}</span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full border ${
                  i === 0
                    ? "border-emerald-700 text-emerald-400"
                    : "border-border text-text-muted"
                }`}
              >
                {i === 0 ? "latest" : snap.id.slice(0, 7)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 2-col: AI panel + Extensions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* AI panel */}
        <div className="glass-card rounded-2xl p-10 md:p-14">
          <div className="w-10 h-10 rounded-lg bg-surface border border-border flex items-center justify-center mb-5">
            <HiOutlineSparkles className="w-5 h-5 text-text-muted" />
          </div>
          <h3 className="text-xl font-bold text-text mb-3">
            Ask your files anything.
          </h3>
          <p className="text-text-muted text-pretty mb-6">
            An integrated AI panel that understands your working directory.
            Query across your content, get answers, and take action — without
            leaving Misty.
          </p>
          {/* Mock chat */}
          <div className="flex flex-col gap-2 text-xs">
            <div className="self-end max-w-[80%] px-3 py-2 rounded-xl bg-elevated border border-border text-text">
              Which files changed since last week?
            </div>
            <div className="self-start max-w-[80%] px-3 py-2 rounded-xl bg-surface border border-border text-text-muted">
              Found 4 modified files in{" "}
              <span className="text-text font-mono">~/projects/</span> since Apr
              11…
            </div>
          </div>
        </div>

        {/* Extensions */}
        <div className="glass-card rounded-2xl p-10 md:p-14">
          <div className="w-10 h-10 rounded-lg bg-surface border border-border flex items-center justify-center mb-5">
            <HiOutlinePuzzlePiece className="w-5 h-5 text-text-muted" />
          </div>
          <h3 className="text-xl font-bold text-text mb-3">
            Built to be extended.
          </h3>
          <p className="text-text-muted text-pretty mb-6">
            Launch custom workflows as isolated processes, embed panels into the
            UI, and build tools that treat your files as first-class citizens.
          </p>
          {/* Extension list */}
          <div className="flex flex-col gap-2 text-xs text-text-muted">
            {["Image optimizer", "PDF converter", "Bulk renamer"].map((ext) => (
              <div
                key={ext}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface border border-border"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span className="flex-1 text-text">{ext}</span>
                <span className="text-[10px] text-text-muted">extension</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
