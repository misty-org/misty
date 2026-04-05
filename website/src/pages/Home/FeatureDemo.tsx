import { useState } from "react";

const tabs = [
  { label: "Browse", key: "browse" },
  { label: "Search", key: "search" },
  { label: "Connect", key: "connect" },
  { label: "Transfer", key: "transfer" },
];

export default function FeatureDemo() {
  const [activeView, setActiveView] = useState("browse");

  return (
    <div className="relative bg-[#2d2d2d]">

      {/* Title Bar with tabs */}
      <div className="h-10 w-full flex items-center justify-between bg-neutral-900/70 pl-3">
        <div className="flex items-center gap-3">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveView(tab.key)}
              className={`px-3 py-1 text-xs font-medium rounded transition-all duration-200 ${
                activeView === tab.key
                  ? "bg-white text-black"
                  : "text-text-muted hover:text-white hover:bg-white/10"
              }`}
            >
              {tab.label}
            </button>
          ))}
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
          <button className="h-full px-3.5 flex items-center justify-center hover:bg-red-600 transition-colors">
            <svg className="w-3 h-3 text-neutral-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="w-full overflow-hidden border-none">
        {activeView === "browse" && (
          <video
            src="/misty-browse.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="w-full block"
          />
        )}
        {activeView === "search" && (
          <video
            src="/misty-search.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="w-full block"
          />
        )}
        {activeView === "transfer" && (
          <video
            src="/misty-transfer.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="w-full block"
          />
        )}
        {activeView === "connect" && (
          <video
            src="/misty-connect.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="w-full block"
          />
        )}
      </div>
    </div>
  );
}
