import {
  normalizeDockingLayout,
  rememberDockingLayout,
  type TabSide,
} from "@/app/shell/dockingLayout";
import { useWindowDockingLayout, useWorkspaceStore } from "@/features/app-windows";
import { Pressable, Surface, Text } from "@/shared/ui";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { TabsPreview } from "./SetupPreviews";

import type { SetupStep } from "@/features/account";

/** This computer's setup, the step that ends the wizard that follows signing in. */
export const setupStepCopy: Record<SetupStep, string> = {
  tabs: "Where do you want the sidebar?",
};

/** The steps the wizard runs here: the side the sidebar sits on. */
export function useSetupSteps(): SetupStep[] {
  return ["tabs"];
}

/** One step's body. */
export function SetupStepBody(_props: { step: SetupStep; onNext(): void }) {
  return <TabsStep />;
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
          <Choice
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
          </Choice>
        ))}
      </div>
    </div>
  );
}

/** A preview tile; the selected one gets a stronger border and a checkmark. */
function Choice(props: {
  label: string;
  selected: boolean;
  onSelect(): void;
  children: ReactNode;
}) {
  return (
    <Pressable
      role="radio"
      aria-checked={props.selected}
      onClick={props.onSelect}
      wash="card"
      className="flex flex-col rounded-lg text-left transition-colors"
    >
      <Surface
        tone={props.selected ? "well" : "none"}
        edge={props.selected ? "strong" : "hairline"}
        radius="lg"
        className="flex flex-col gap-2 p-2"
      >
        {props.children}
        <Text bare tone="bright" className="flex items-center gap-1.5 px-0.5">
          <span className="min-w-0 flex-1 text-sm">{props.label}</span>
          {props.selected ? <Check aria-hidden="true" className="shrink-0" /> : null}
        </Text>
      </Surface>
    </Pressable>
  );
}
