import { accountResets, deviceDataErasers, setupFlow } from "@/features/account";
import {
  cleanupOnEngine,
  MistyMarkdown,
  resetAiSurfaceAccountState,
  runOnEngine,
  useLinkedFolders,
  watchAllRunEvents,
} from "@/features/agents";
import { engineConfigHost } from "@/features/engine-config/host";
import { libraryPicker } from "@/features/files";
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
import { noteAsk, vocativeRouting, voiceCleanup, voiceDevice, voiceEngine } from "@/features/voice";
import {
  SetupStepBody,
  setupStepCopy,
  TourInfoButton,
  useSetupStepDone,
  useSetupSteps,
} from "@/features/onboarding";
import {
  arcadeGateway,
  drawingsApi,
  handoffGateway,
  createYjsProvider,
  liveGateway,
  MistyLibraryPicker,
  resetNotesAccountState,
  resetSpacesAccountState,
  spaceRequest,
  uploadLibraryBlob,
  uploadLibraryPath,
  useSpacesStore,
} from "@/features/spaces";

// Where features that sit above another feature plug into it. The lower feature owns the seam
// (so it never imports the upper one); this file, loaded once at startup, fills each one in.

accountResets.listen((previousAccountId) => {
  resetSpacesAccountState();
  resetNotesAccountState();
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

spacesGateway.provide({
  ...arcadeGateway,
  ...handoffGateway,
  ...liveGateway,
  uploadLibraryPath,
  uploadLibraryBlob,
  spaceRequest,
  openCodeRoom: (ticket, doc, refresh) => createYjsProvider(ticket, doc, "code-room", refresh),
  itemTools: () => import("@/features/spaces/agentItemTools").then((m) => m.agentItemTools),
  async createDrawing(spaceId, title, elements) {
    const drawing = await drawingsApi.create(spaceId, title);
    const { seedDrawing } =
      await import("@/features/spaces/journal/drawings/components/useDrawingSeed");
    seedDrawing(drawing.id, elements as Parameters<typeof seedDrawing>[1]);
    return drawing;
  },
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
      return /\/(media|library)(\/|\?|#|$)/i.test(tab.route) ? "tool:library" : "tool:space";
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

libraryPicker.provide(MistyLibraryPicker);

noteAsk.provide((input) => openMisty(input));
