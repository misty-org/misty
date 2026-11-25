import { provideReactionPicker } from "@/shared/lib/reaction_picker";
import { ChatEmojiPicker } from "./chat/emoji/ChatEmojiPicker";
export type * from "./list/spaces_store_types";
export type * from "./list/realtime_types";
export * from "./list/reference_mode";
export * from "./list/use_spaces_store";
export { useSpacesConnection, type SpacesConnection } from "./list/spaces_connection";
export { SpaceInvitationRedemption } from "./components/SpaceInvitationRedemption";

export { SpaceChatPanel } from "./chat/SpaceChatPanel";

export { driveGateway } from "./drive/drive_gateway";
export { DrivePickerPanel } from "./drive/DrivePickerPanel";
export { handoffGateway } from "./handoffs/handoff_gateway";
export { liveGateway } from "./handoffs/live_gateway";
export { spaceRequest } from "./api/api";
export { fetchProtectedBlob } from "./api/protected_download";
export { provideDirectSpaceCheck } from "./api/attachment_paths";
export {
  peekSpaceResource,
  refreshSpaceResource,
  setSpaceResource,
  useSpaceResource,
} from "./api/space_resource";
export { onRealtimeMessage, onRealtimeOpen, sendRealtimeMessage } from "./list/realtime_extras";
export { useVoicePresence, voiceChannelOf, watchVoicePresence } from "./list/voice_presence";
export { memberCan, prepareMemberCan, useSpaceCan } from "./roles/use_space_roles";
export {
  doingLabel,
  memberAgentsIn,
  useMemberAgents,
  type MemberAgentStatus,
} from "./list/member_agents";
export { SpaceChat } from "./chat/SpaceChat";
export { useChatBar } from "./chat/components/ChatBarButtons";
export { pageMisty } from "./apps/page_misty";
export { appCallsHost, voiceChannelPage } from "./apps/app_calls";
export { SpaceWorkspaceSurface } from "./overview/SpaceWorkspaceSurface";
export { SpaceWindowBridge } from "./SpaceWindowBridge";
export { useWindowSpace } from "./components/space-row/use_window_space";
export { SpaceAvatar, spaceTone } from "./components/SpaceAvatar";
export { SpaceBarMenu, SpacePresence } from "./components/space-row/SpaceBarItems";
export { useSpaceGallery } from "./home/use_space_gallery";
export { kindIcon } from "./home/GalleryPreview";
export { searchSpaceText, type SpaceSearchHit } from "./search/space_search";

export { SpaceSelector } from "./components/space-row/SpaceSelector";
export { GlobalCreateSpaceDialog } from "./create/GlobalCreateSpaceDialog";
export { useInstalledApps } from "./apps/use_installed_apps";
export { useAppPrograms } from "./apps/use_app_programs";
export { useAppStandby } from "./apps/use_app_standby";
export { appRoute } from "./apps/app_routes";
export { AppsLauncher, useAppLauncher } from "./apps/AppsLauncher";
export { registryApps, useRegistryApps, catalogLogoUrl } from "./apps/third_party_apps";
export { useExploreInstalledApps } from "./apps/explore_installed_apps";
export { useSpaceConversations } from "./chat/sidebar/use_space_conversations";
export { NewChannelButton } from "./chat/sidebar/NewChannelButton";
export {
  ChannelCategoryList,
  ChannelHeadingTools,
  ChannelList,
} from "./chat/sidebar/ChannelCategories";
export { channelLayout } from "./chat/sidebar/channel_layout";
export { ChannelRowMenu } from "./chat/sidebar/SidebarChannelTools";
export { useSpaceEveryoneUnread } from "./chat/space_conversations_resource";
export { ChatAvatar } from "./chat/components/ChatAvatar";
export { useMemberPicture } from "./members/member_pictures";
export { MemberFace } from "./members/MemberFace";
export {
  conversationName,
  groupConversations,
  isGroupDirectMessage,
} from "./chat/sidebar/conversation_groups";
export { conversationPath, spaceChatPath } from "./chat/chat_route";
export type { Space } from "./api/dto/entities";

export { LazyFilesPage as FilesPage } from "./file-manager/LazyFilesPage";
export { startFilesReveal } from "./file-manager/files_reveal";

provideReactionPicker(ChatEmojiPicker);
export { isChatOnScreen } from "./chat/hooks/window_viewing";
