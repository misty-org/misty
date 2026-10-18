import type { DockingLayout } from "@/features/app-shell/dockingLayout";
import { useAuth } from "@/features/auth";
import { BrowserImportFlow } from "@/features/browser-import";
import {
  selectAppearancePreferences,
  useSettingsStore,
  type AppThemeMode,
} from "@/features/settings";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { useWindowDockingLayout, useWorkspaceStore } from "@/features/workspace";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Pressable,
} from "@/shared/ui";
import { Check } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { LayoutPreview, ThemePreview } from "./SetupPreviews";
import { SpacesStep } from "./SpacesStep";
import { useSetupStore, type SetupStep } from "./useSetupStore";

const themeChoices: Array<{ value: AppThemeMode; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const layoutChoices: Array<{ label: string; detail: string; layout: DockingLayout }> = [
  {
    label: "Horizontal tabs",
    detail: "Tabs across the top, navigation on the left",
    layout: { navigation: "left", tabs: "top" },
  },
  {
    label: "Vertical tabs",
    detail: "Tabs in a sidebar, navigation on the opposite side",
    layout: { navigation: "right", tabs: "left" },
  },
];

const stepCopy: Record<SetupStep, { title: string; description: string }> = {
  spaces: {
    title: "Meet Spaces",
    description: "A Space is a profile for one part of your life, like work, school or family.",
  },
  theme: {
    title: "Choose a theme",
    description: "System follows your computer's light or dark appearance.",
  },
  layout: {
    title: "Choose a layout",
    description:
      "Pick where tabs sit in every Space's window. Navigation sits on the opposite side, and you can switch later in Settings.",
  },
  import: {
    title: "Import from your browser",
    description: "Bring bookmarks, history, settings and sign-ins into Misty, or skip this step.",
  },
};

/**
 * First-run setup after sign-in, in place of a walkthrough: theme, layout and, in the desktop app,
 * importing from another browser. Each choice applies immediately; all of them stay in Settings.
 */
export function FirstRunSetup() {
  const { user, transitioning } = useAuth();
  const isOpen = useSetupStore((state) => state.isOpen);
  const step = useSetupStore((state) => state.step);
  const setStep = useSetupStore((state) => state.setStep);
  const finishSetup = useSetupStore((state) => state.finishSetup);
  const visible = isOpen && !transitioning && Boolean(user?.id);
  // Importing reads other browsers on this computer, so it needs the native app.
  const steps: SetupStep[] = hasTauriInternals()
    ? ["spaces", "layout", "theme", "import"]
    : ["spaces", "layout", "theme"];
  // There is no default layout: the person picks one before going on.
  const [layoutChosen, setLayoutChosen] = useState(false);
  const index = Math.max(0, steps.indexOf(step));
  const finish = () => finishSetup(user?.id);
  const next = () => (index < steps.length - 1 ? setStep(steps[index + 1]) : finish());

  useEffect(() => {
    // Native page views draw above the app, so hide them while the dialog is up.
    setBrowserWebviewsSuspended(visible, "first-run-setup");
    return () => setBrowserWebviewsSuspended(false, "first-run-setup");
  }, [visible]);

  if (!visible) return null;
  const copy = stepCopy[steps[index]];
  return (
    <Dialog open onOpenChange={(open) => !open && finish()}>
      <DialogContent className="max-w-[560px] gap-0 p-7">
        <p className="text-xs text-cream-muted">
          Step {index + 1} of {steps.length}
        </p>
        <DialogTitle className="mt-1 text-base font-semibold text-cream-bright">
          {copy.title}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm leading-relaxed text-cream-muted">
          {copy.description}
        </DialogDescription>
        <div className="mt-6">
          {steps[index] === "spaces" ? <SpacesStep /> : null}
          {steps[index] === "theme" ? <ThemeStep /> : null}
          {steps[index] === "layout" ? (
            <LayoutStep chosen={layoutChosen} onChoose={() => setLayoutChosen(true)} />
          ) : null}
          {steps[index] === "import" ? (
            <BrowserImportFlow onClose={finish} closeLabel="Skip" />
          ) : null}
        </div>
        {steps[index] !== "import" ? (
          <div className="mt-7 flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-cream-muted" onClick={finish}>
              Skip setup
            </Button>
            <div className="ml-auto flex gap-2">
              {index > 0 ? (
                <Button variant="outline" onClick={() => setStep(steps[index - 1])}>
                  Back
                </Button>
              ) : null}
              <Button
                onClick={next}
                disabled={steps[index] === "layout" && !layoutChosen}
                title={
                  steps[index] === "layout" && !layoutChosen ? "Choose a layout first" : undefined
                }
              >
                {index === steps.length - 1 ? "Done" : "Continue"}
              </Button>
            </div>
          </div>
        ) : null}
        <p className="mt-4 text-xs text-cream-muted">You can change these anytime in Settings.</p>
      </DialogContent>
    </Dialog>
  );
}

function ThemeStep() {
  const themeMode = useSettingsStore(
    (state) => selectAppearancePreferences(state.settings?.document).themeMode,
  );
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
      {themeChoices.map((choice) => (
        <Choice
          key={choice.value}
          label={choice.label}
          selected={themeMode === choice.value}
          onSelect={() => updateSetting("appearance", "theme_mode", choice.value)}
        >
          <ThemePreview mode={choice.value} />
        </Choice>
      ))}
    </div>
  );
}

function LayoutStep({ chosen, onChoose }: { chosen: boolean; onChoose(): void }) {
  const current = useWindowDockingLayout();
  const setLayout = useWorkspaceStore((state) => state.setWindowDockingLayout);
  return (
    <div role="radiogroup" aria-label="Layout" className="grid grid-cols-2 gap-3">
      {layoutChoices.map((choice) => (
        <Choice
          key={choice.label}
          label={choice.label}
          detail={choice.detail}
          selected={
            chosen &&
            current.navigation === choice.layout.navigation &&
            current.tabs === choice.layout.tabs
          }
          onSelect={() => {
            setLayout(choice.layout);
            onChoose();
          }}
        >
          <LayoutPreview layout={choice.layout} />
        </Choice>
      ))}
    </div>
  );
}

/** A preview tile; the selected one gets a stronger border and a checkmark. */
function Choice(props: {
  label: string;
  detail?: string;
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
      <span className="flex items-start gap-1.5 px-0.5">
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-cream-bright">{props.label}</span>
          {props.detail ? (
            <span className="block text-xs leading-snug text-cream-muted">{props.detail}</span>
          ) : null}
        </span>
        {props.selected ? (
          <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-cream-bright" />
        ) : null}
      </span>
    </Pressable>
  );
}
