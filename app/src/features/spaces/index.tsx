import { lazy, Suspense } from "react";

export { GlobalCreateSpaceDialog } from "./GlobalCreateSpaceDialog";
export { SpaceAvatar } from "./components/SpaceAvatar";
export { SpaceManagementNavigation } from "./components/SpaceManagementNavigation";
export { SpaceRowActions } from "./components/SpaceRowActions";
export { spaceDestination, spaceLandingRoute } from "./navigation";
export { canOpenMistySpaceSection, preferredMistySpace } from "./mistySpace";
export { rememberedJournalRoute, rememberedPlannerRoute } from "./spacesShell/spaceSubpageMemory";
export { canonicalSpaceRoute } from "./spaceRouteNormalization";
export { spaceSectionPath, useSpacePanelRoute } from "./components/spacePanel/spacePanelRoute";
export { SpaceSetupCards } from "./components/SpaceSetupCards";
export { SpaceSidebarPageSection } from "./components/SpaceSidebarPageSection";
export { SpaceSidebarSection } from "./components/SpaceSidebarSection";
export { SpaceViewModeToggle } from "./components/SpaceViewModeToggle";
export { InstagramBrandIcon } from "./social/InstagramBrandIcon";
export { MessengerBrandIcon, XBrandIcon } from "./social/SocialProviderBrandIcons";
export {
  socialConversationPath,
  socialProvider,
  socialProviderFromRoute,
  socialProviderPath,
} from "./social/socialRoute";
export type * from "./model/stores/spaces/interfaces/useSpacesStore";
export type * from "./model/stores/spaces/types/useSpacesBackendStore";
export { SpacesRealtimeBridge } from "./SpacesRealtimeBridge";
export * from "./store/agent-run-events";
export * from "./store/reference-cache";
export * from "./store/reference-mode";
export * from "./store/useSpaceAgendaPreferences";
export * from "./store/useSpacesStore";
export * from "./store/useSpacesTabsStore";

const LazySpacesPage = lazy(() => import("./SpacesPage"));
const LazySpaceDetail = lazy(async () => ({ default: (await import("./SpacesPage")).SpaceDetail }));
// Lazy like the other Space surfaces: it reaches drawings and chat, which pull
// in collaboration modules that must not load just because this barrel is
// imported for something small.
const LazySpaceSectionView = lazy(async () => ({
  default: (await import("./SpaceSectionView")).SpaceSectionView,
}));
const LazySpacesIndexRedirect = lazy(async () => ({
  default: (await import("./SpacesPage")).SpacesIndexRedirect,
}));
const LazySpaceInvitationRedemption = lazy(async () => ({
  default: (await import("./components/SpaceInvitationRedemption")).SpaceInvitationRedemption,
}));
const LazySpaceNavRail = lazy(async () => ({
  default: (await import("./components/SpaceNavRail")).SpaceNavRail,
}));
const LazyRoadmapDailyMockup = lazy(async () => ({
  default: (await import("./roadmap/spaceRoadmap/RoadmapDailyMockup")).RoadmapDailyMockup,
}));

export function SpacesPage() {
  return (
    <Suspense fallback={null}>
      <LazySpacesPage />
    </Suspense>
  );
}

export function SpaceSectionView(props: {
  spaceId: string;
  section: string;
  studioKind?: string;
  workspaceTabId?: string;
}) {
  return (
    <Suspense fallback={null}>
      <LazySpaceSectionView {...props} />
    </Suspense>
  );
}

export function SpaceDetail() {
  return (
    <Suspense fallback={null}>
      <LazySpaceDetail />
    </Suspense>
  );
}

export function SpacesIndexRedirect() {
  return (
    <Suspense fallback={null}>
      <LazySpacesIndexRedirect />
    </Suspense>
  );
}

export function SpaceInvitationRedemption() {
  return (
    <Suspense fallback={null}>
      <LazySpaceInvitationRedemption />
    </Suspense>
  );
}

export function SpaceNavRail() {
  return (
    <Suspense fallback={null}>
      <LazySpaceNavRail />
    </Suspense>
  );
}

export function RoadmapDailyMockup() {
  return (
    <Suspense fallback={null}>
      <LazyRoadmapDailyMockup />
    </Suspense>
  );
}

export default SpacesPage;
