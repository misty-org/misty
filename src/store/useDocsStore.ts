import { create } from "zustand";
import {
  defaultSectionId,
  getSectionById,
  getSectionIndex,
  guideCategories,
  guideSections,
  hasSection,
} from "../pages/Docs/sections";
import type { Category, Section } from "../pages/Docs/types";

const sectionAliases: Record<string, string> = {
  "getting-started": "introduction",
  providers: "providers-overview",
  "self-hosting": "s3-sftp",
  api: "plugins-overview",
};

interface DocsStore {
  activeSectionId: string;
  sidebarOpen: boolean;
  expandedCategories: Record<string, boolean>;
  setActiveSection: (id: string) => void;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleCategory: (key: string) => void;
  initializeFromPath: (pathname: string, basePath?: string) => void;
}

function sectionIdFromPath(pathname: string, basePath = "/docs") {
  const normalizedBase = `/${basePath.replace(/^\/+|\/+$/g, "")}`;
  const sectionId = pathname
    .replace(new RegExp(`^${normalizedBase}/?`), "")
    .split("/")
    .filter(Boolean)[0];
  const resolvedId = sectionId
    ? sectionAliases[sectionId] ?? sectionId
    : defaultSectionId;

  return hasSection(resolvedId) ? resolvedId : defaultSectionId;
}

function expandActiveCategory(
  expandedCategories: Record<string, boolean>,
  sectionId: string,
) {
  const section = getSectionById(sectionId);

  return expandedCategories[section.category]
    ? expandedCategories
    : { ...expandedCategories, [section.category]: true };
}

export const useDocsStore = create<DocsStore>((set) => ({
  activeSectionId: defaultSectionId,
  sidebarOpen: false,
  expandedCategories: { "getting-started": true },
  setActiveSection: (id) =>
    set((state) => {
      const nextSectionId = hasSection(id) ? id : defaultSectionId;

      return {
        activeSectionId: nextSectionId,
        expandedCategories: expandActiveCategory(
          state.expandedCategories,
          nextSectionId,
        ),
      };
    }),
  openSidebar: () => set({ sidebarOpen: true }),
  closeSidebar: () => set({ sidebarOpen: false }),
  toggleCategory: (key) =>
    set((state) => ({
      expandedCategories: {
        ...state.expandedCategories,
        [key]: !state.expandedCategories[key],
      },
    })),
  initializeFromPath: (pathname, basePath = "/docs") =>
    set((state) => {
      const activeSectionId = sectionIdFromPath(pathname, basePath);

      return {
        activeSectionId,
        expandedCategories: expandActiveCategory(
          state.expandedCategories,
          activeSectionId,
        ),
      };
    }),
}));

export function resolveDocsSectionId(pathname: string, basePath = "/docs") {
  return sectionIdFromPath(pathname, basePath);
}

export function selectCurrentSection(state: DocsStore): Section {
  return getSectionById(state.activeSectionId);
}

export function selectPreviousSection(state: DocsStore): Section | null {
  const currentIndex = getSectionIndex(state.activeSectionId);

  return currentIndex > 0 ? guideSections[currentIndex - 1] : null;
}

export function selectNextSection(state: DocsStore): Section | null {
  const currentIndex = getSectionIndex(state.activeSectionId);

  return currentIndex < guideSections.length - 1
    ? guideSections[currentIndex + 1]
    : null;
}

export function selectDocsCategories(): Category[] {
  return guideCategories;
}

export function selectDocsSections(): Section[] {
  return guideSections;
}
