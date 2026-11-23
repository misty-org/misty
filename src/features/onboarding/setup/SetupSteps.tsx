import {
  normalizeDockingLayout,
  rememberDockingLayout,
  type TabSide,
} from "@/app/shell/docking_layout";
import { useProjectsHome, useProjectsHomePath } from "@/features/agents";
import { useWindowDockingLayout, useWorkspaceStore } from "@/features/app-windows";
import { Button, Surface, Text, useNotice } from "@misty/ui";
import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { PreviewChoice } from "./PreviewChoice";
import { TabsPreview } from "./SetupPreviews";

import type { SetupStep } from "@/features/account";

export const setupStepCopy: Record<SetupStep, string> = {
  tabs: "Where do you want the sidebar?",
  projects: "Where do your projects go?",
};

export function useSetupSteps(): SetupStep[] {
  return ["tabs", "projects"];
}

export function useSetupStepDone(step: SetupStep | null): boolean {
  const projects = useProjectsHomePath();
  return step !== "projects" || Boolean(projects);
}

export function SetupStepBody(props: { step: SetupStep; onNext(): void }) {
  return props.step === "projects" ? <ProjectsStep /> : <TabsStep />;
}

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
