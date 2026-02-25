import { useState } from "react";
import { FaPlay } from "react-icons/fa";

const tabs = [
  { label: "Browse", key: "browse" },
  { label: "Search", key: "search" },
  { label: "Transfer", key: "transfer" },
  { label: "Connect", key: "connect" },
];

export default function FeatureDemo() {
  const [activeView, setActiveView] = useState("browse");
  const [isDemoPlaying, setIsDemoPlaying] = useState(false);

  return (
    <div>

      {/* Feature Toggle & Demo Controls */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-8 relative z-20">

        <div className="hidden md:block w-35"></div>

        <div className="flex bg-neutral-900/80 backdrop-blur-md p-1.5 rounded-full border border-white/10 shadow-lg shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setActiveView(tab.key); setIsDemoPlaying(false); }}
              className={`px-5 py-2 text-sm font-medium rounded-full transition-all duration-300 ${
                !isDemoPlaying && activeView === tab.key
                  ? "bg-zinc-100 text-black shadow-sm"
                  : "text-text-muted hover:text-zinc-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex justify-end w-full md:w-35">
          <button
            onClick={() => setIsDemoPlaying(true)}
            className={`flex items-center gap-2.5 px-2 py-1.5 pr-4 backdrop-blur-md border border-white/10 rounded-full text-sm font-medium transition-all duration-300 shadow-xl group ml-auto md:ml-0 ${
              isDemoPlaying
                ? "bg-zinc-100 text-black"
                : "bg-neutral-900/80 text-zinc-200 hover:bg-zinc-100 hover:text-black hover:scale-105"
            }`}
          >
            {!isDemoPlaying && (
              <div className="absolute inset-0 rounded-full bg-white/50 opacity-20 group-hover:hidden" />
            )}  
            <FaPlay className="w-2.5 h-2.5 ml-0.5" />
            <span className="whitespace-nowrap">Watch Demo</span>
          </button>
        </div>
      </div>

      {/* Screenshot Container */}
      <div className="relative">

        {/* Windows-style Title Bar */}
        <div className="h-9 w-full rounded-t-xl flex items-center justify-between bg-neutral-900/70">
          <div className="flex items-center gap-2 px-3">
            <span className="text-xs font-mono text-text-muted">misty</span>
          </div>
          <div className="flex items-center h-full">
            <button className="h-full px-3.5 flex items-center justify-center hover:bg-white/10 transition-colors">
              <svg className="w-3 h-3 text-neutral-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 6h8" />
              </svg>
            </button>
            <button className="h-full px-3.5 flex items-center justify-center hover:bg-white/10 transition-colors">
              <svg className="w-3 h-3 text-neutral-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="2" width="8" height="8" rx="0.5" />
              </svg>
            </button>
            <button className="h-full px-3.5 flex items-center justify-center hover:bg-red-600 transition-colors rounded-tr-xl">
              <svg className="w-3 h-3 text-neutral-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          </div>
        </div>

        {/* Screenshot Area */}
        <div className="overflow-hidden rounded-b-xl relative">

          {activeView === "browse" && !isDemoPlaying && (
            <video
              src="/misty-browse.mp4"
              autoPlay
              loop
              muted
              playsInline
              className="w-full rounded-b-xl"
            />
          )}

          {activeView === "search" && !isDemoPlaying && (
            <div className="aspect-video flex flex-col items-center justify-center">
              <span className="text-text-muted font-mono mb-2">[ Search Screenshot ]</span>
              <span className="text-xs text-text-muted/50">Cross-cloud file search demo.</span>
            </div>
          )}

          {activeView === "transfer" && !isDemoPlaying && (
            <div className="aspect-video flex flex-col items-center justify-center">
              <span className="text-text-muted font-mono mb-2">[ Transfer Queue Screenshot ]</span>
              <span className="text-xs text-text-muted/50">Show progress bars and raw gRPC transfer speeds here.</span>
            </div>
          )}

          {activeView === "connect" && !isDemoPlaying && (
            <div className="aspect-video flex flex-col items-center justify-center">
              <span className="text-text-muted font-mono mb-2">[ Connect Accounts Screenshot ]</span>
              <span className="text-xs text-text-muted/50">Manage linked storage providers.</span>
            </div>
          )}

          {isDemoPlaying && (
            <div className="aspect-video flex flex-col items-center justify-center">
              <span className="text-text-muted font-mono mb-2">[ Demo Video ]</span>
              <span className="text-xs text-text-muted/50">Embed your demo video here.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}