import { lazy, Suspense } from "react";

export { MessageOriginBadge } from "./components/MessageOriginBadge";
export { SpaceAvatar } from "./components/SpaceAvatar";
export { spaceSectionPath, useSpacePanelRoute } from "./components/spacePanel/spacePanelRoute";
export { SpaceSetupCards } from "./components/SpaceSetupCards";
export { SpaceSidebarPageSection } from "./components/SpaceSidebarPageSection";
export { SpaceSidebarSection } from "./components/SpaceSidebarSection";
export type * from "./model/stores/spaces/interfaces/useSpacesStore";
export type * from "./model/stores/spaces/types/useSpacesBackendStore";
export { SpacesRealtimeBridge } from "./SpacesRealtimeBridge";
export * from "./store/agent-run-events";
export * from "./store/reference-cache";
export * from "./store/reference-mode";
export * from "./store/useSpaceAgendaPreferences";
export * from "./store/useSpaceDiscordStore";
export * from "./store/useSpacesStore";
export * from "./store/useSpacesTabsStore";

const LazySpacesPage = lazy(() => import("./SpacesPage"));
const LazySpaceDetail = lazy(async () => ({ default: (await import("./SpacesPage")).SpaceDetail }));
const LazySpacesIndexRedirect = lazy(async () => ({
  default: (await import("./SpacesPage")).SpacesIndexRedirect,
}));
const LazySpaceInvitationRedemption = lazy(async () => ({
  default: (await import("./components/SpaceInvitationRedemption")).SpaceInvitationRedemption,
}));
const LazySpaceNavRail = lazy(async () => ({
  default: (await import("./components/SpaceNavRail")).SpaceNavRail,
}));

export function SpacesPage() {
  return (
    <Suspense fallback={null}>
      <LazySpacesPage />
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

export default SpacesPage;
