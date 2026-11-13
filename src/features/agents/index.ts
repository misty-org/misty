export { default as AgentsPage } from "./page/AgentsPage";
export { agentsDeviceSnapshot, forgetFolder, shareFolder } from "./personal/useAgentsStore";
export { shareFolderWarning } from "./plans/AgentFolderMenu";
export { ensureAgentDevice } from "./personal/useAgentDeviceStore";

export { CursorCompanionController } from "./tutor/cursor/CursorCompanionController";
export { TutorTraySync } from "./tutor/cursor/tutorTray";
export { TrayAgentsSync } from "./tray/trayAgents";
export { MistyPanelDock } from "./panel/MistyPanelDock";
export { useMistyPanelSide, type MistyPanelSide } from "./panel/mistyPanelSide";
export { useMistyPanelStore, type MistyPanelView } from "./panel/mistyPanelStore";

export type { AgentScope } from "./personal/agentScope";

export type { DisplayCapture } from "./tutor/cursor/protocol";

export { usePersonalAgentsStore } from "./personal/personalAgentsStore";
export { openAgentsHub, useAgentsHub, type AgentsHubPage } from "./hub/agentsHubStore";
export { HubAgentsPage } from "./hub/HubAgentsPage";
export { EngineMarketplace } from "./marketplace/EngineMarketplace";

export type { AppRequest } from "./connected-apps/api";
export { AppRequestCard } from "./connected-apps/AppRequestCard";
export { appsApi, type ConnectedApp } from "./connected-apps/api";
export { AppLogo } from "./connected-apps/ConnectedAppRows";
export { DirectApps } from "./connected-apps/DirectApps";
export { StatusRow, StatusTable, type StatusState } from "./progress/StatusTable";

export { settleProgress, withAnswer, withToolEvent } from "./progress/progressTimeline";
export { grantsApi, groupGrants, lastUsedText } from "./grants/api";
export type { AgentGrant } from "./grants/api";
// Dictation hands "Hey <agent>, …" to an agent through the cursor session.
export { useCompanionState } from "./tutor/cursor/companionState";
export { routeLocalFollowup, useLocalExecution } from "./runs/local-execution/localExecution";
export { AgentAvatar, AgentMark } from "./personal/AgentAvatar";
export { lessonTurnPayload } from "./tutor/lessons/lessonRouter";
export { useLessonStore } from "./tutor/lessons/lessonStore";
export { tutorChatIds, useTutorChatIds, useTutorStore } from "./tutor/tutorStore";
export { watchSharedNotebooks } from "./tutor/notebookShare";
export type { LessonPayload, LessonSummaryPayload } from "./tutor/lessons/lessonTypes";

// Public surface used by other features (generated from their imports).
export { managedAiRequest } from "../../api/managed/managed";
export { BrowserContextMenuBridge } from "./conversations/context/BrowserContextMenuBridge";
export { MistyContextBridgeHost } from "./conversations/context/MistyContextBridgeHost";
export { useMistyStore } from "./conversations/state/useMistyStore";
export { AgentExecutionSurface } from "./island/AgentExecutionSurface";
export { agentAccountId } from "./personal/agentAccount";
export { desktopDeviceGrants } from "./personal/deviceGrants";
export { listPersonalAgents } from "./personal/personalAgentsApi";
export { resetAiSurfaceAccountState } from "./runs/invocations";
export {
  aiSurfaceApi,
  subscribeToAiInvocation,
  type AiUserSettings,
  type ScreenLocation,
} from "./runs/invocations/api";
export { useAiSurfaceStore } from "./runs/invocations/store";
export {
  type AiArtifact,
  type AiCompanionAnchor,
  type AiContextReference,
  type AiSelectionSnapshot,
  type AiSuggestedAction,
  type AiSurfaceAdapter,
} from "./runs/invocations/invocationTypes";
export { AgentJobWorker } from "./runs/jobs/AgentJobWorker";
export { setKeepAwakeForAgents } from "./runs/jobs/keepAwake";
export { followAddress } from "./runs/local-run/localRunParts";
export {
  AiPaneHost,
  useAiSurfaceActions,
  useAiSurfaceAdapter,
  type AiSurfaceId,
} from "./runs/markdown/AiPaneHost";
export { AiSelectionMenu } from "./runs/markdown/AiSelectionMenu";
export { MistyMarkdown } from "./runs/markdown/MistyMarkdown";

// Public surface used by other features (generated from their imports).
export { ModelsSection } from "./models/ModelsSection";
export {
  AgentDefaultsSection,
  AgentPermissionsSection,
  CompanionSection,
} from "./settings/FeatureSections";

// Public surface used by other features (generated from their imports).
export { spaceAgentsApi, type SpaceAgent } from "./api/space-agents";
export { spacesGateway, type AgentArtifactProvenance } from "./spaces-gateway/spacesGateway";
export { findVocative, routeToAgent } from "./tutor/cursor/vocativeRoute";

// Public surface used by other features (generated from their imports).
export { openMisty } from "./conversations/ask/handoff";
export { draftRequestForAgent } from "./conversations/ask/draftRequest";
export { conversationInSpace } from "./conversations/state/conversationSpace";
export { useAgentAccountId } from "./personal/agentAccount";
export { AgentsNow } from "./virtual/AgentsNow";
export { VirtualStudio } from "./virtual/VirtualStudio";
export { useStudioAgents } from "./virtual/useStudioAgents";
export { useTeammateAgents, type TeammateAgent } from "./virtual/teammates";
export { shortAgo, useChatStatuses, type ChatStatus } from "./page/useChatStatuses";
export { EngineMark, hasEngineMark } from "@/features/engine-config/EngineMark";
export { EnginesStep } from "./engines/EnginesStep";
export { engineSetupState, type EngineSetupState } from "./engines/EngineSetupRow";
// The Space home's overview reads runs and linked folders.
export { runtimeAiApi } from "./AgentsRuntime";
export type { MistyActivityEntry } from "./conversations/state/activity";
export type { GlobalAiConversation } from "./conversations/state/conversationTypes";
export { watchAllRunEvents } from "./runs/local-run/localRunEvents";
export {
  currentSpaceKey,
  folderName,
  folderOf,
  useLinkedFolders,
  useSpaceFolders,
} from "./engines/enginesApi";
export { RunNotifier } from "./runs/notices/RunNotifier";
// Personas from the bundled catalog, and their page in Settings.
export { PersonaCatalogSection } from "./personas";
export { projectApi, type GitStatus } from "./context-panel/projectApi";
export { useContextPanel } from "./context-panel/contextPanelStore";
export { endNewChatTerminals } from "./page/useViewConversation";
export { readDeviceState, updateDeviceState } from "./context-panel/folders/deviceState";
export {
  fileChats,
  forkChat,
  isChatUnread,
  setChatsArchived,
  setChatsPinned,
  setChatsUnread,
} from "./conversations/state/chatOrganizing";
export {
  useAgentFoldersStore as useChatSectionsStore,
  type AgentConversationFolder as ChatSection,
} from "./shared-folders/agentFoldersStore";
export { PickUpDialog } from "./pickup/PickUpDialog";
export { pickUpRequest, pickUpTopic } from "./pickup/pickUp";
export { activityApi, type RunRow, type RunStep } from "./activity/activityApi";
export { HappeningNow, type OpenChatRequest } from "./activity/HappeningNow";
export { RunSteps, StepPicture } from "./activity/RunSteps";
export { RunStateBadge } from "./activity/RunLabels";
export { forgetStepPictures, useRunSteps } from "./activity/useRunSteps";
export { useSpaceRuns } from "./activity/useSpaceRuns";
export { AgentActivitySettings } from "./activity/AgentActivitySettings";

// What ⌘K search reads and starts.
export { askInNewChat, resumeInNewChat } from "./conversations/startChat";
export { requestChatFind } from "./conversations/view/navigation/chatFind";
export { messageSearchText } from "./conversations/view/navigation/timelineSearch";
export {
  searchEngineSessions,
  type EngineSearchHit,
} from "./conversations/view/engine/engineHistory";
export { searchNotebooks, type SearchHit as NotebookSearchHit } from "./tutor/tutorSearch";
export { directAppsApi, type DirectCatalogApp } from "./connected-apps/directApi";
export {
  openFolderFile,
  searchFolderFiles,
  type FolderFileHit,
} from "./context-panel/files/folderFileSearch";
