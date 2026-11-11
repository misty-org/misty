import { lazy } from "react";
import { accountResets, deviceDataErasers, memoryExport, setupFlow } from "@/features/account";
import { resetAiSurfaceAccountState } from "@/features/agents";
import { libraryPicker } from "@/features/files";
import { dockLeaves, spacesDirectory, useWorkspaceStore } from "@/features/app-windows";
import { shortcutScope } from "@/features/shortcuts";
import type { ShortcutScope } from "@/shared/shortcuts/shortcutTypes";
import {
  agentsDeviceSnapshot,
  useMistyStore,
  ensureAgentDevice,
  findVocative,
  openMisty,
  routeToAgent,
  spacesGateway,
} from "@/features/agents";
import { allMethods, saveMethod } from "@/features/agents/localRun";
import { browserLibrary } from "@/features/browser";
import { memoryApi, memoryWorkflows } from "@/features/memory";
import { noteAsk, vocativeRouting, voiceDevice } from "@/features/voice";
import { SetupStepBody, setupStepCopy, useSetupSteps } from "@/features/onboarding";
import {
  drawingsApi,
  handoffGateway,
  MistyLibraryPicker,
  resetNotesAccountState,
  resetSpacesAccountState,
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
  await browserLibrary.clearHistory({ since: 0 });
  await browserLibrary.removeDownloads({ since: 0 });
  await browserLibrary.clearWebsiteData({ kinds: ["cookies", "cache"], since: 0 });
});

memoryExport.provide(async (now) => {
  const name = `misty-memory-${now.toISOString().slice(0, 10)}.zip`;
  const url = URL.createObjectURL(await memoryApi.exportZip());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  return name;
});

const ModelSetupPanel = lazy(async () => ({
  default: (await import("@/features/agents/models/modelSetup")).ModelSetupPanel,
}));

setupFlow.provide({
  stepCopy: setupStepCopy,
  useSteps: useSetupSteps,
  StepBody: SetupStepBody,
  ModelSetupPanel,
});

spacesDirectory.provide(useSpacesStore);

spacesGateway.provide({
  ...handoffGateway,
  uploadLibraryPath,
  uploadLibraryBlob,
  async createDrawing(spaceId, title, elements) {
    const drawing = await drawingsApi.create(spaceId, title);
    const { seedDrawing } =
      await import("@/features/spaces/journal/drawings/components/useDrawingSeed");
    seedDrawing(drawing.id, elements as Parameters<typeof seedDrawing>[1]);
    return drawing;
  },
});

vocativeRouting.provide({ findVocative, routeToAgent });

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
      return tab.route.toLowerCase().includes("/library") ? "tool:library" : "tool:space";
    default:
      return "workspace";
  }
}

shortcutScope.provide(focusedShortcutScope);

libraryPicker.provide(MistyLibraryPicker);

memoryWorkflows.provide({
  accountId: () => useMistyStore.getState().accountId,
  list: allMethods,
  save: (account, draft) => saveMethod(account, draft as Parameters<typeof saveMethod>[1]),
});

noteAsk.provide((input) => openMisty(input));
