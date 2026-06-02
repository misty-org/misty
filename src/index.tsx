import { useEffect, useState } from "react";
import type { Category } from "./data";
import { guideSections } from "./guide-data";
import Sidebar from "./Sidebar";
import CenterPanel from "./CenterPanel";
import RightPanel from "./RightPanel";

const guideCategories: Category[] = [
  { key: "getting-started", label: "Getting Started", ids: ["introduction", "installation", "setup"] },
  { key: "providers", label: "Providers", ids: ["providers-overview", "google-drive", "onedrive", "s3-sftp"] },
  { key: "backups", label: "Backups", ids: ["backups-overview", "snapshots", "restore"] },
  { key: "search", label: "Search", ids: ["search-overview", "indexing", "search-workflows"] },
  { key: "plugins", label: "Plugins", ids: ["plugins-overview", "building-plugins"] },
  { key: "mistyai", label: "MistyAI", ids: ["mistyai-overview", "ask-mistyai", "mistyai-actions"] },
];

const sectionAliases: Record<string, string> = {
  "getting-started": "introduction",
  providers: "providers-overview",
  "self-hosting": "s3-sftp",
  api: "plugins-overview",
};

export interface DocsProps {
  basePath?: string;
  initialSectionId?: string;
}

function getSectionFromPath(basePath: string, fallback: string) {
  if (typeof window === "undefined") return fallback;

  const normalizedBase = `/${basePath.replace(/^\/+|\/+$/g, "")}`;
  const sectionId = window.location.pathname
    .replace(new RegExp(`^${normalizedBase}/?`), "")
    .split("/")
    .filter(Boolean)[0];
  const resolvedSectionId = sectionId ? sectionAliases[sectionId] ?? sectionId : fallback;

  return guideSections.some((section) => section.id === resolvedSectionId) ? resolvedSectionId : fallback;
}

export default function Docs({ basePath = "/docs", initialSectionId = "introduction" }: DocsProps) {
  const [activeId, setActiveId] = useState(() => getSectionFromPath(basePath, initialSectionId));
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const syncActiveSection = () => setActiveId(getSectionFromPath(basePath, initialSectionId));
    window.addEventListener("popstate", syncActiveSection);
    return () => window.removeEventListener("popstate", syncActiveSection);
  }, [basePath, initialSectionId]);

  const selectSection = (id: string) => {
    setActiveId(id);

    if (typeof window !== "undefined") {
      const normalizedBase = `/${basePath.replace(/^\/+|\/+$/g, "")}`;
      window.history.pushState(null, "", `${normalizedBase}/${id}`);
      document.getElementById("docs-content-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const section = guideSections.find((s) => s.id === activeId) ?? guideSections[0];

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-[1440px] flex-col overflow-auto px-5 py-4 sm:px-6 lg:h-screen lg:px-8 xl:px-10">
      <div className="border-b border-white/[0.07] pb-4">
        <h1 className="text-[34px] font-semibold tracking-[-0.03em] text-text">Docs</h1>
      </div>

      <div className="grid min-h-0 min-w-[1080px] flex-1 grid-cols-[240px_minmax(560px,1fr)_220px] pt-0">
        <Sidebar
          sections={guideSections}
          categories={guideCategories}
          activeId={activeId}
          onSelect={selectSection}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <CenterPanel
          section={section}
          sections={guideSections}
          activeId={activeId}
          onSelect={selectSection}
        />
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
