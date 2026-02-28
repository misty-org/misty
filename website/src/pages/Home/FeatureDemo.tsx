import { useState } from "react";

export default function FeatureDemo() {
  const [activeView, setActiveView] = useState("browser");
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

      {/* Feature Toggle & Demo Controls */}
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 mb-8 relative z-20 px-2">

        <div className="hidden md:block w-[140px]"></div>

        <div className="flex bg-neutral-900/80 backdrop-blur-md p-1.5 rounded-full border border-white/10 shadow-lg shrink-0">
          <button
            onClick={() => setActiveView("browser")}
            className={`px-5 py-2 text-sm font-medium rounded-full transition-all duration-300 ${activeView === "browser" ? "bg-white text-black shadow-sm" : "text-text-muted hover:text-white"}`}
          >
            Unified Browser
          </button>
          <button
            onClick={() => setActiveView("transfers")}
            className={`px-5 py-2 text-sm font-medium rounded-full transition-all duration-300 ${activeView === "transfers" ? "bg-white text-black shadow-sm" : "text-text-muted hover:text-white"}`}
          >
            Transfer Queue
          </button>
          <button
            onClick={() => setActiveView("network")}
            className={`px-5 py-2 text-sm font-medium rounded-full transition-all duration-300 ${activeView === "network" ? "bg-white text-black shadow-sm" : "text-text-muted hover:text-white"}`}
          >
            Storage Nodes
          </button>
        </div>

        <div className="flex justify-end w-full md:w-[140px]">
          <button
            onClick={() => {}}
            className="flex items-center gap-2.5 px-2 py-1.5 pr-4 bg-neutral-900/80 backdrop-blur-md border border-white/10 rounded-full text-sm font-medium text-white hover:bg-white hover:text-black hover:scale-105 transition-all duration-300 shadow-xl group ml-auto md:ml-0"
          >
            <div className="w-7 h-7 rounded-full bg-white text-black flex items-center justify-center group-hover:bg-black group-hover:text-white transition-colors relative shrink-0">
              <div className="absolute inset-0 rounded-full bg-white/50 animate-ping opacity-20 group-hover:hidden"></div>
              <svg className="w-2.5 h-2.5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <span className="whitespace-nowrap">Watch Demo</span>
          </button>
        </div>
      </div>

      {/* Screenshot Container */}
      <div className="relative mx-auto max-w-5xl">

        {/* Windows-style Title Bar */}
        <div className="h-9 w-full rounded-t-xl flex items-center justify-between bg-neutral-900/80">
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
        <div className="overflow-hidden rounded-b-xl aspect-video relative">
          {activeView === "browser" && (
            <div className="absolute top-0 -bottom-px -left-px -right-px">
              <img src="/empty_files.png" alt="Unified file browser" className="w-full h-full object-center rounded-b-xl" />
            </div>
          )}

          {activeView === "transfers" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-text-muted font-mono mb-2">[ Transfer Queue Screenshot ]</span>
              <span className="text-xs text-text-muted/50">Show progress bars and raw gRPC transfer speeds here.</span>
            </div>
          )}

          {activeView === "network" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-text-muted font-mono mb-2">[ Storage Nodes Screenshot ]</span>
              <span className="text-xs text-text-muted/50">Show connected distributed backend nodes and status.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}