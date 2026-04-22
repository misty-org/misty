import { useState } from "react";
import type { Category } from "./data";
import { guideSections } from "./guide-data";
import Sidebar from "./Sidebar";
import CenterPanel from "./CenterPanel";
import RightPanel from "./RightPanel";

const guideCategories: Category[] = [
  { key: "getting-started", label: "Getting Started", ids: ["introduction", "installation"] },
  { key: "architecture", label: "Architecture", ids: ["architecture"] },
  { key: "extensions", label: "Extensions & CLI", ids: ["extensions", "cli"] },
];

export default function Docs() {
  const [activeId, setActiveId] = useState("introduction");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const section = guideSections.find((s) => s.id === activeId)!;

  return (
    <div className="max-w-screen mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr_200px] min-h-screen pt-16">
        <Sidebar
          sections={guideSections}
          categories={guideCategories}
          activeId={activeId}
          onSelect={setActiveId}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <CenterPanel section={section} />
        <RightPanel section={section} />

        <button
          onClick={() => setSidebarOpen(true)}
          className="fixed bottom-6 left-6 z-40 lg:hidden w-12 h-12 rounded-full bg-primary hover:bg-primary-hover text-bg flex items-center justify-center shadow-lg shadow-primary/25 transition-colors cursor-pointer"
          aria-label="Open navigation"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
