import { accountResets, deviceDataErasers, setupFlow } from "@/features/account";
import {
  cleanupOnEngine,
  filesPage,
  MistyMarkdown,
  provideExploreApps,
  resetAiSurfaceAccountState,
  runOnEngine,
  useLinkedFolders,
  watchAllRunEvents,
} from "@/features/agents";
import { engineConfigHost } from "@/features/engine-config/host";
import { drivePicker } from "@/features/files";
import { dockLeaves, spacesDirectory, useWorkspaceStore } from "@/features/app-windows";
import { shortcutScope } from "@/features/shortcuts";
import type { ShortcutScope } from "@/shared/shortcuts/shortcut_types";
import {
  agentCallsHost,
  agentsDeviceSnapshot,
  ensureAgentDevice,
  findVocative,
  memberFace,
  openMisty,
  routeToAgent,
  spacesGateway,
  tourCorner,
} from "@/features/agents";
import { browserLibrary } from "@/features/browser";
import {
  callsForApps,
  endCallsForAccountReset,
  useAgentCall,
  useAgentCallTranscript,
  useAnyCall,
} from "@/features/direct";
import { noteAsk, vocativeRouting, voiceCleanup, voiceDevice, voiceEngine } from "@/features/voice";
import {
  setupStepCopy,
  TourInfoButton,
  useSetupStepDone,
  useSetupSteps,
} from "@/features/onboarding";
import {
  catalogLogoUrl,
  driveGateway,
  FilesPage,
  handoffGateway,
  liveGateway,
  MemberFace,
  appCallsHost,
  voiceChannelPage,
  pageMisty,
  resetSpacesAccountState,
  spaceRequest,
  startFilesReveal,
  useExploreInstalledApps,
  useSpacesStore,
} from "@/features/spaces";
import { lazyPart } from "./LazyPart";

const AgentCallSplit = lazyPart(() =>
  import("@/features/direct/calls/AgentCallSplit").then((module) => module.AgentCallSplit),
);
const VoiceChannelPage = lazyPart(() =>
  import("@/features/direct/calls/VoiceChannelPage").then((module) => module.VoiceChannelPage),
);
const SetupStepBody = lazyPart(() =>
  import("@/features/onboarding/setup/SetupSteps").then((module) => module.SetupStepBody),
);
const DrivePickerPanel = lazyPart(() =>
  import("@/features/spaces/drive/DrivePickerPanel").then((module) => module.DrivePickerPanel),
);

accountResets.listen((previousAccountId) => {
  endCallsForAccountReset();
  resetSpacesAccountState();
  resetAiSurfaceAccountState(previousAccountId);
});

deviceDataErasers.listen(async () => {
  await browserLibrary.clearWebsiteData({ kinds: ["cookies", "cache"], since: 0 });
});

tourCorner.provide(TourInfoButton);
memberFace.provide(MemberFace);
agentCallsHost.provide({
  start: (input) => useAgentCall.getState().start(input),
  useBusy: useAnyCall,
  useTranscript: useAgentCallTranscript,
  Split: AgentCallSplit,
});

setupFlow.provide({
  stepCopy: setupStepCopy,
  useSteps: useSetupSteps,
  StepBody: SetupStepBody,
  useStepDone: useSetupStepDone,
});

spacesDirectory.provide(useSpacesStore);

filesPage.provide(FilesPage);
startFilesReveal();

appCallsHost.provide(callsForApps);
voiceChannelPage.provide(VoiceChannelPage);

spacesGateway.provide({
  ...handoffGateway,
  ...liveGateway,
  ...driveGateway,
  spaceRequest,
  pageMisty,
});

vocativeRouting.provide({ findVocative, routeToAgent });

voiceEngine.provide({ run: (input) => runOnEngine(input) });

voiceCleanup.provide(cleanupOnEngine);

voiceDevice.provide(async () => {
  const snapshot = await agentsDeviceSnapshot();
  if (!snapshot.device || snapshot.device.status === "revoked")
    throw new Error("Sign in on this computer to use voice.");
  return (await ensureAgentDevice(snapshot.device)).id;
});

function focusedShortcutScope(): ShortcutScope {
  const { layout } = useWorkspaceStore.getState();
  const pane = dockLeaves(layout.root).find((candidate) => candidate.id === layout.focusedPaneId);
  const tab = pane?.views.find((candidate) => candidate.id === pane.activeViewId);
  switch (tab?.surfaceId) {
    case "space":
      return "tool:space";
    default:
      return "workspace";
  }
}

shortcutScope.provide(focusedShortcutScope);

engineConfigHost.provide({
  useLinkedFolders,
  Markdown: MistyMarkdown,
  watchRunEvents: watchAllRunEvents,
});

drivePicker.provide(DrivePickerPanel);

noteAsk.provide((input) => openMisty(input));

provideExploreApps({ useExploreInstalledApps, catalogLogoUrl });
