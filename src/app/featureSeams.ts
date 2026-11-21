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
import type { ShortcutScope } from "@/shared/shortcuts/shortcutTypes";
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

// Where features that sit above another feature plug into it. The lower feature owns the seam
// (so it never imports the upper one); this file, loaded once at startup, fills each one in.

accountResets.listen((previousAccountId) => {
  resetSpacesAccountState();
  resetAiSurfaceAccountState(previousAccountId);
});

deviceDataErasers.listen(async () => {
  await browserLibrary.clearWebsiteData({ kinds: ["cookies", "cache"], since: 0 });
});

// Agents surfaces show their tour's corner "i"; tours live in onboarding, above agents.
tourCorner.provide(TourInfoButton);

setupFlow.provide({
  stepCopy: setupStepCopy,
  useSteps: useSetupSteps,
  StepBody: SetupStepBody,
  useStepDone: useSetupStepDone,
});

spacesDirectory.provide(useSpacesStore);

// The Files page lives in spaces (it needs the Space drives); agents shows it at /agents?view=files. An
// agent's `files.reveal` opens it at the item, heard once for the window from here.
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

// Voice's own writing (capture notes, dictation tidying) runs on the default engine.
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

// Explore (agents) shows a Space's apps, which belong to Spaces, which builds on agents.
provideExploreApps({ useAppUpdates, ExploreAppsSection, catalogLogoUrl });
