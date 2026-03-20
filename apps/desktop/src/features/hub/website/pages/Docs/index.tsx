import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ContentPanel from "./ContentPanel";
import Sidebar from "./Sidebar";
import RightPanel from "./RightPanel";
import {
  selectCurrentSection,
  selectDocsCategories,
  selectDocsSections,
  selectNextSection,
  selectPreviousSection,
  useDocsStore,
} from "../../store/useDocsStore";
import SectionPager from "./SectionPager";

export interface DocsProps {
  basePath?: string;
  initialSectionId?: string;
}

function docsPath(basePath: string, sectionId: string) {
  const normalizedBase = `/${basePath.replace(/^\/+|\/+$/g, "")}`;
  return `${normalizedBase}/${sectionId}`;
}

export default function Docs({ basePath = "/docs" }: DocsProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const activeId = useDocsStore((state) => state.activeSectionId);
  const sidebarOpen = useDocsStore((state) => state.sidebarOpen);
  const expandedCategories = useDocsStore((state) => state.expandedCategories);
  const initializeFromPath = useDocsStore((state) => state.initializeFromPath);
  const setActiveSection = useDocsStore((state) => state.setActiveSection);
  const openSidebar = useDocsStore((state) => state.openSidebar);
  const closeSidebar = useDocsStore((state) => state.closeSidebar);
  const toggleCategory = useDocsStore((state) => state.toggleCategory);
  const section = useDocsStore(selectCurrentSection);
  const previousSection = useDocsStore(selectPreviousSection);
  const nextSection = useDocsStore(selectNextSection);
  const sections = selectDocsSections();
  const categories = selectDocsCategories();

  useEffect(() => {
    initializeFromPath(location.pathname, basePath);
  }, [basePath, initializeFromPath, location.pathname]);

  const selectSection = (id: string) => {
    setActiveSection(id);
    navigate(docsPath(basePath, id));
    document
      .getElementById("docs-content-scroll")
      ?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-[1440px] flex-col overflow-hidden px-5 sm:px-6 lg:h-screen lg:px-8 xl:px-10">
      <div className="border-b border-white/[0.07] py-4">
        <h1 className="text-[34px] font-semibold tracking-[-0.03em] text-text">Docs</h1>
      </div>

      <div className="grid min-h-0 min-w-[1080px] flex-1 grid-cols-[240px_minmax(560px,1fr)_220px] pt-0">
        <Sidebar
          sections={sections}
          categories={categories}
          activeId={activeId}
          expandedCategories={expandedCategories}
          onSelect={selectSection}
          onToggleCategory={toggleCategory}
          open={sidebarOpen}
          onClose={closeSidebar}
        />
        <div className="flex min-h-0 min-w-0 flex-col">
          <ContentPanel section={section} />
          <SectionPager
            previousSection={previousSection}
            nextSection={nextSection}
            onSelect={selectSection}
          />
        </div>
        <RightPanel section={section} />

        <button
          onClick={openSidebar}
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
