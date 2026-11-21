export type * from "./list/spacesStoreTypes";
export type * from "./list/realtimeTypes";
export * from "./list/reference-mode";
export * from "./list/useSpacesStore";
export { useSpacesConnection, type SpacesConnection } from "./list/spacesConnection";
export { SpaceInvitationRedemption } from "./components/SpaceInvitationRedemption";

export { SpaceChatPanel } from "./chat/SpaceChatPanel";

// What other features import from here.
export { driveGateway } from "./drive/driveGateway";
export { DrivePickerPanel } from "./drive/DrivePickerPanel";
export { handoffGateway } from "./handoffs/handoffGateway";
export { liveGateway } from "./handoffs/liveGateway";
export { spaceRequest } from "./api/api";
export {
  peekSpaceResource,
  refreshSpaceResource,
  setSpaceResource,
  useSpaceResource,
} from "./api/spaceResource";
export { onRealtimeMessage, onRealtimeOpen, sendRealtimeMessage } from "./list/realtimeExtras";
export { useVoicePresence, voiceChannelOf, watchVoicePresence } from "./list/voicePresence";
// A DM is a Space of kind "direct": its view draws the Space chat for the DM's id.
export { SpaceChat } from "./chat/SpaceChat";
export { PinnedMessagesButton } from "./chat/components/PinnedMessagesButton";
export { ChatBarButtons } from "./chat/components/ChatBarButtons";
export { createYjsProvider } from "./journal/notes/createYjsProvider";
export { pageMisty } from "./apps/pageMisty";
export { appCallsHost } from "./apps/appCalls";
export { SpaceWorkspaceSurface } from "./overview/SpaceWorkspaceSurface";
export { SpaceWindowBridge } from "./SpaceWindowBridge";
export { useWindowSpace } from "./components/space-row/useWindowSpace";
export { SpaceBarMenu, SpacePresence } from "./components/space-row/SpaceBarItems";
export { useSpaceGallery } from "./home/useSpaceGallery";
export { kindIcon } from "./home/GalleryPreview";
export { searchSpaceText, type SpaceSearchHit } from "./search/spaceSearch";

// The Space's sidebar (`app/layouts/DesktopLayout/SpaceNavigator.tsx`).
export { SpaceSelector } from "./components/space-row/SpaceSelector";
export { GlobalCreateSpaceDialog } from "./create/GlobalCreateSpaceDialog";
export { useSpaceApps } from "./apps/useSpaceApps";
export { useAppPrograms } from "./apps/useAppPrograms";
export { useAppStandby } from "./apps/useAppStandby";
export { appRoute } from "./apps/appRoutes";
export { SpaceAppsLauncher, useAppLauncher } from "./apps/SpaceAppsLauncher";
export { catalogApps, catalogLogoUrl } from "./apps/thirdPartyApps";
// Explore (in agents) takes these through the shell's seam (`src/app/featureSeams.ts`).
export { useAppUpdates } from "./apps/appUpdates";
export { ExploreAppsSection } from "./apps/ExploreAppsSection";
export { useSpaceConversations } from "./chat/sidebar/useSpaceConversations";
export { NewChannelButton } from "./chat/sidebar/NewChannelButton";
export { ChannelRowMenu } from "./chat/sidebar/SidebarChannelTools";
export { useSpaceEveryoneUnread } from "./chat/spaceConversationsResource";
export { ChatAvatar } from "./chat/components/ChatAvatar";
export { useMemberPicture } from "./members/memberPictures";
export {
  conversationName,
  groupConversations,
  isGroupDirectMessage,
} from "./chat/sidebar/conversationGroups";
export { conversationPath, spaceChatPath } from "./chat/chatRoute";
export type { Space } from "./api/dto/entities";

// Files, Misty's file manager (`/agents?view=files`), and the browser the app picker wraps.
export { FilesBrowser, FilesPage, startFilesReveal } from "./file-manager";
