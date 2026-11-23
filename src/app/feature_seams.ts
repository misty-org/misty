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
  agentsDeviceSnapshot,
  ensureAgentDevice,
  findVocative,
  openMisty,
  routeToAgent,
  spacesGateway,
  tourCorner,
} from "@/features/agents";
import { browserLibrary } from "@/features/browser";
import { callsForApps, VoiceChannelPage } from "@/features/direct";
import { noteAsk, vocativeRouting, voiceCleanup, voiceDevice, voiceEngine } from "@/features/voice";
import {
  SetupStepBody,
  setupStepCopy,
  TourInfoButton,
  useSetupStepDone,
  useSetupSteps,
} from "@/features/onboarding";
import {
  catalogLogoUrl,
  DrivePickerPanel,
  driveGateway,
  ExploreAppsSection,
  FilesPage,
  handoffGateway,
  liveGateway,
  appCallsHost,
  voiceChannelPage,
  pageMisty,
  resetSpacesAccountState,
  spaceRequest,
  startFilesReveal,
  useAppUpdates,
  useSpacesStore,
} from "@/features/spaces";

accountResets.listen((previousAccountId) => {
  resetSpacesAccountState();
  resetAiSurfaceAccountState(previousAccountId);
});

deviceDataErasers.listen(async () => {
  await browserLibrary.clearWebsiteData({ kinds: ["cookies", "cache"], since: 0 });
});

tourCorner.provide(TourInfoButton);

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

provideExploreApps({ useAppUpdates, ExploreAppsSection, catalogLogoUrl });
