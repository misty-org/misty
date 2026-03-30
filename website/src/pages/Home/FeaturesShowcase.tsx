import { HiOutlineBolt, HiOutlineShieldCheck, HiOutlineMagnifyingGlass, HiOutlineArrowsRightLeft, HiOutlineLockClosed, HiOutlineSignal } from "react-icons/hi2";

export default function FeaturesShowcase() {
  return (
    <div className="flex flex-col gap-4">
      {/* Misty helps you — full width */}
      <div className="glass-card rounded-2xl p-10 md:p-14">
        <h3 className="text-xl font-bold text-text mb-6">Misty helps you</h3>
        <ul className="flex flex-col gap-4 text-sm md:text-base text-text-muted">
          <li className="flex items-start gap-3">
            <svg className="w-5 h-5 text-primary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            <span>Manage local drives and remote storage from one place</span>
          </li>
          <li className="flex items-start gap-3">
            <svg className="w-5 h-5 text-primary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            <span>Drag and drop files between platforms with local file operations</span>
          </li>
          <li className="flex items-start gap-3">
            <svg className="w-5 h-5 text-primary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            <span>Search across all connected providers at once</span>
          </li>
          <li className="flex items-start gap-3">
            <svg className="w-5 h-5 text-primary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            <span>Link multiple accounts from the same service</span>
          </li>
        </ul>
      </div>

      {/* Fast — full width */}
      <div className="glass-card rounded-2xl p-10 md:p-14 text-center relative overflow-hidden">
        {/* Streak lines */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[30%] left-0 w-20 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent animate-streak" />
          <div className="absolute top-[50%] left-0 w-32 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent animate-streak-2" />
          <div className="absolute top-[70%] left-0 w-16 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent animate-streak-3" />
        </div>
        <div className="relative">
          <div className="flex justify-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-surface border border-border flex items-center justify-center">
              <HiOutlineBolt className="w-6 h-6 text-text" />
            </div>
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-text tracking-tight mb-4">
            <span className="text-white">Fast</span>, zero bloat.
          </h2>
          <p className="text-text-muted max-w-xl mx-auto text-pretty">
            Files stream on demand — no full sync, no waiting. Search across every provider at once and never lose your place.
          </p>
        </div>
      </div>

      {/* 2-col row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card rounded-2xl p-10 md:p-14">
          <div className="w-10 h-10 rounded-lg bg-surface border border-border flex items-center justify-center mb-5">
            <HiOutlineMagnifyingGlass className="w-5 h-5 text-text-muted" />
          </div>
          <h3 className="text-xl font-bold text-text mb-3">Unified search</h3>
          <p className="text-text-muted text-pretty mb-5">
            One query across every connected provider. No more switching between tabs to find a file.
          </p>
          {/* Mini diagram */}
          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span className="px-2.5 py-1.5 rounded-lg bg-surface border border-border">Google Drive</span>
            <span className="px-2.5 py-1.5 rounded-lg bg-surface border border-border">OneDrive</span>
            <span className="px-2.5 py-1.5 rounded-lg bg-surface border border-border">Dropbox</span>
            <span className="text-text-muted">&rarr;</span>
            <span className="px-2.5 py-1.5 rounded-lg bg-elevated border border-border text-text font-medium">One index</span>
          </div>
        </div>
        <div className="glass-card rounded-2xl p-10 md:p-14">
          <div className="w-10 h-10 rounded-lg bg-surface border border-border flex items-center justify-center mb-5">
            <HiOutlineArrowsRightLeft className="w-5 h-5 text-text-muted" />
          </div>
          <h3 className="text-xl font-bold text-text mb-3">Background transfers</h3>
          <p className="text-text-muted text-pretty mb-5">
            Moves and copies run quietly while you keep working. Large transfers don't block anything.
          </p>
          {/* Mini transfer queue */}
          <div className="flex flex-col gap-2 text-xs">
            <div className="flex items-center gap-3">
              <span className="text-text-muted w-28 truncate">photos.zip</span>
              <div className="flex-1 h-1.5 rounded-full bg-surface overflow-hidden">
                <div className="h-full rounded-full bg-text-muted animate-fill-1" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-text-muted w-28 truncate">report.pdf</span>
              <div className="flex-1 h-1.5 rounded-full bg-surface overflow-hidden">
                <div className="h-full rounded-full bg-text-muted animate-fill-2" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-text-muted w-28 truncate">backup/</span>
              <div className="flex-1 h-1.5 rounded-full bg-surface overflow-hidden">
                <div className="h-full rounded-full bg-text-muted animate-fill-3" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Secure — full width */}
      <div className="glass-card rounded-2xl p-10 md:p-14 text-center">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-surface border border-border flex items-center justify-center">
            <HiOutlineShieldCheck className="w-6 h-6 text-text" />
          </div>
        </div>
        <h2 className="text-2xl md:text-3xl font-bold text-text tracking-tight mb-4">
          <span className="text-white">Secure</span> by design.
        </h2>
        <p className="text-text-muted max-w-xl mx-auto text-pretty">
          Your credentials never leave your machine. Direct connections over OAuth — no relay servers, no middlemen, no data we can see.
        </p>
      </div>

      {/* 2-col row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card rounded-2xl p-10 md:p-14">
          <div className="w-10 h-10 rounded-lg bg-surface border border-border flex items-center justify-center mb-5">
            <HiOutlineLockClosed className="w-5 h-5 text-text-muted" />
          </div>
          <h3 className="text-xl font-bold text-text mb-3">Local-only</h3>
          <p className="text-text-muted text-pretty mb-5">
            All processing happens on your device. Nothing is routed through our servers.
          </p>
          {/* Mini architecture diagram */}
          <div className="flex items-center justify-between text-xs text-text-muted gap-2">
            <div className="flex flex-col items-center gap-1.5">
              <div className="px-3 py-2 rounded-lg bg-surface border border-border text-center">
                <span className="text-text font-medium">Your device</span>
              </div>
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-text-muted">OAuth</span>
              <div className="w-16 border-t border-dashed border-border" />
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <div className="px-3 py-2 rounded-lg bg-surface border border-border text-center">
                <span>Cloud provider</span>
              </div>
            </div>
          </div>
        </div>
        <div className="glass-card rounded-2xl p-10 md:p-14">
          <div className="w-10 h-10 rounded-lg bg-surface border border-border flex items-center justify-center mb-5">
            <HiOutlineSignal className="w-5 h-5 text-text-muted" />
          </div>
          <h3 className="text-xl font-bold text-text mb-3">Direct connections</h3>
          <p className="text-text-muted text-pretty mb-5">
            Every API call goes straight from your machine to the provider. Optional Tailscale support for secure remote access.
          </p>
          {/* Mini connection diagram */}
          <div className="flex flex-col gap-2 text-xs text-text-muted">
            {["Google Drive", "OneDrive", "Dropbox"].map((provider) => (
              <div key={provider} className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="w-24">{provider}</span>
                <div className="flex-1 border-t border-border" />
                <span className="text-[10px]">Connected</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
