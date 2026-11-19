import {
  normalizeDockingLayout,
  rememberDockingLayout,
  type TabSide,
} from "@/app/shell/dockingLayout";
import { useProjectsHome, useProjectsHomePath } from "@/features/agents";
import { useWindowDockingLayout, useWorkspaceStore } from "@/features/app-windows";
import { Button, Surface, Text, useNotice } from "@/shared/ui";
import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { PreviewChoice } from "./PreviewChoice";
import { TabsPreview } from "./SetupPreviews";

import type { SetupStep } from "@/features/account";

/** This computer's setup, the step that ends the wizard that follows signing in. */
export const setupStepCopy: Record<SetupStep, string> = {
  tabs: "Where do you want the sidebar?",
  projects: "Where do your projects go?",
};

/** The steps the wizard runs here: the side the sidebar sits on, then where projects go. */
export function useSetupSteps(): SetupStep[] {
  return ["tabs", "projects"];
}

/** Whether a step can go on: the projects folder has to be chosen; the sidebar has a side. */
export function useSetupStepDone(step: SetupStep | null): boolean {
  const projects = useProjectsHomePath();
  return step !== "projects" || Boolean(projects);
}

/** One step's body. */
export function SetupStepBody(props: { step: SetupStep; onNext(): void }) {
  return props.step === "projects" ? <ProjectsStep /> : <TabsStep />;
}

/**
 * Where "Open in Code" makes a chat's project. The person picks it in the system's dialog, which
 * opens on their home folder; Misty suggests no place. It stays in Settings.
 */
function ProjectsStep() {
  const path = useProjectsHomePath();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  const choose = () => {
    setBusy(true);
    void useProjectsHome
      .getState()
      .choose()
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setBusy(false));
  };
  return (
    <div className="flex flex-col gap-3">
      <Text as="p" size="body" tone="muted" wrap className="m-0">
        When a chat becomes a project, Misty makes its folder here and opens it in Code.
      </Text>
      <div className="flex min-w-0 items-center gap-3">
        {path ? (
          <Surface tone="well" radius="md" className="min-w-0 flex-1 px-3 py-2">
            <Text size="meta" tone="default" as="div">
              {path}
            </Text>
          </Surface>
        ) : null}
        <Button disabled={busy} onClick={choose}>
          <FolderOpen aria-hidden="true" />
          {path ? "Change…" : "Choose folder…"}
        </Button>
      </div>
    </div>
  );
}

const tabSideChoices: Array<{ value: TabSide; label: string }> = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

/** The sidebar side applies immediately and stays in Settings. */
function TabsStep() {
  const layout = useWindowDockingLayout();
  const setLayout = useWorkspaceStore((state) => state.setWindowDockingLayout);
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Sidebar side" className="grid grid-cols-2 gap-3">
        {tabSideChoices.map((choice) => (
          <PreviewChoice
            key={choice.value}
            label={choice.label}
            selected={layout.tabs === choice.value}
            onSelect={() => {
              const next = normalizeDockingLayout({
                navigation: layout.navigation,
                tabs: choice.value,
              });
              setLayout(next);
              // New windows open with the side picked here too.
              rememberDockingLayout(next);
            }}
          >
            <TabsPreview side={choice.value} />
          </PreviewChoice>
        ))}
      </div>
    </div>
  );
}
