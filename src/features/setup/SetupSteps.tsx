import { BrowserImportFlow } from "@/features/browser-import";
import { ExtensionsSetupStep } from "@/features/extensions/ExtensionsSetupStep";
import { useExtensionsStore } from "@/features/extensions/store";
import { setBarsAutoHide, useBarsAutoHide } from "@/features/app-shell/barsAutoHide";
import { normalizeDockingLayout, type TabSide } from "@/features/app-shell/dockingLayout";
import { useWindowDockingLayout, useWorkspaceStore } from "@/features/workspace";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { cn, Pressable, Switch } from "@/shared/ui";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { TabsPreview } from "./SetupPreviews";

/** This computer's setup: import and extensions end the wizard that follows signing in; the tab
 * side is asked once the browser is on screen (`useTabSidePrompt`). */
export type SetupStep = "import" | "extensions" | "tabs";

export const setupStepCopy: Record<SetupStep, string> = {
  import: "Import from your browser",
  extensions: "Add an ad blocker and a password manager",
  tabs: "Where do you want your tabs?",
};

/** The steps the wizard runs here: importing reads other browsers on this computer, so it needs
 * the native app; extensions need a platform that runs them. Outside the native app there is
 * nothing else to set up, so the tab side stays in the wizard. */
export function useSetupSteps(): SetupStep[] {
  const extensionsSupported = useExtensionsStore((state) => state.supported);
  if (!hasTauriInternals()) return ["tabs"];
  return extensionsSupported ? ["import", "extensions"] : ["import"];
}

/** One step's body. Importing brings its own Skip, which moves on. */
export function SetupStepBody(props: { step: SetupStep; onNext(): void }) {
  if (props.step === "import")
    return <BrowserImportFlow onClose={props.onNext} closeLabel="Skip" />;
  if (props.step === "extensions") return <ExtensionsSetupStep />;
  return <TabsStep />;
}

const tabSideChoices: Array<{ value: TabSide; label: string }> = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

/** The tab side applies immediately and stays in Settings. */
function TabsStep() {
  const layout = useWindowDockingLayout();
  const setLayout = useWorkspaceStore((state) => state.setWindowDockingLayout);
  const autoHide = useBarsAutoHide();
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Tab side" className="grid grid-cols-2 gap-3">
        {tabSideChoices.map((choice) => (
          <Choice
            key={choice.value}
            label={choice.label}
            selected={layout.tabs === choice.value}
            onSelect={() =>
              setLayout(
                normalizeDockingLayout({ navigation: layout.navigation, tabs: choice.value }),
              )
            }
          >
            <TabsPreview side={choice.value} />
          </Choice>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 px-0.5 text-sm text-cream-bright">
        Auto-hide tabs and Space bar
        <Switch
          aria-label="Auto-hide tabs and Space bar"
          checked={autoHide}
          onCheckedChange={setBarsAutoHide}
        />
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
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-2 text-left transition-colors",
        props.selected
          ? "border-cream-muted bg-charcoal-hover"
          : "border-charcoal-border hover:bg-charcoal-hover",
      )}
    >
      {props.children}
      <span className="flex items-center gap-1.5 px-0.5">
        <span className="min-w-0 flex-1 text-sm text-cream-bright">{props.label}</span>
        {props.selected ? (
          <Check aria-hidden="true" className="size-4 shrink-0 text-cream-bright" />
        ) : null}
      </span>
    </Pressable>
  );
}
