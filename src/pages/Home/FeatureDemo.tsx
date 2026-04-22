import { useState } from "react";

const tabs = [
  { label: "Browse", key: "browse", src: "/misty-browse.png" },
  { label: "Search", key: "search", src: "/misty-search.png" },
  { label: "Connect", key: "connect", src: "/misty-connect.png" },
  { label: "Activity", key: "activity", src: "/misty-activity.png" },
  { label: "Plugins", key: "plugins", src: "/misty-plugins.png" },
  { label: "Backup", key: "backup", src: "/misty-backup.png" },
];

export default function FeatureDemo() {
  const [activeView, setActiveView] = useState("browse");

  const activeTab = tabs.find((t) => t.key === activeView)!;

  return (
    <div className="relative bg-[#2d2d2d]">

      {/* Title Bar with tabs */}
      <div className="h-10 w-full flex items-center justify-between bg-neutral-900/70 pl-3 overflow-x-auto">
        <div className="flex items-center gap-3">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveView(tab.key)}
              className={`px-3 py-1 text-xs font-medium rounded transition-all duration-200 whitespace-nowrap ${
                activeView === tab.key
                  ? "bg-white text-black"
                  : "text-text-muted hover:text-white hover:bg-white/10"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center h-full shrink-0">
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

      {/* Content Area — all images rendered for preload, only active one shown */}
      <div className="w-full overflow-hidden border-none">
        {tabs.map((tab) => (
          <img
            key={tab.key}
            src={tab.src}
            alt={`Misty ${tab.label} view`}
            className={`w-full block ${activeView === tab.key ? "" : "hidden"}`}
          />
        ))}
      </div>
    </div>
  );
}
