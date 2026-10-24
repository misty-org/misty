import { useAuth } from "@/features/auth";
import { BrowserImportFlow } from "@/features/browser-import";
import { normalizeDockingLayout, type TabSide } from "@/features/app-shell/dockingLayout";
import { useWindowDockingLayout, useWorkspaceStore } from "@/features/workspace";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
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
import { useEffect, type ReactNode } from "react";
import { TabsPreview } from "./SetupPreviews";
import { useSetupStore, type SetupStep } from "./useSetupStore";

const tabSideChoices: Array<{ value: TabSide; label: string }> = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

const stepCopy: Record<SetupStep, { title: string; description: string }> = {
  import: {
    title: "Import from your browser",
    description: "Bring bookmarks, history, settings and sign-ins into Misty, or skip this step.",
  },
  tabs: {
    title: "Where do you want your tabs?",
    description: "Tabs sit in a sidebar on one side of the window.",
  },
};

/**
 * First-run setup after the welcome, signed in or not, in place of a walkthrough: importing from another browser (desktop
 * app only) and which side the tabs sit on. The tab side applies immediately and stays in Settings.
 */
export function FirstRunSetup() {
  const { user, transitioning } = useAuth();
  const isOpen = useSetupStore((state) => state.isOpen);
  const step = useSetupStore((state) => state.step);
  const setStep = useSetupStore((state) => state.setStep);
  const finishSetup = useSetupStore((state) => state.finishSetup);
  const visible = isOpen && !transitioning;
  // Importing reads other browsers on this computer, so it needs the native app.
  const steps: SetupStep[] = hasTauriInternals() ? ["import", "tabs"] : ["tabs"];
  const index = Math.max(0, steps.indexOf(step));
  const finish = () => finishSetup(user?.id);
  const next = () => (index < steps.length - 1 ? setStep(steps[index + 1]) : finish());

  useEffect(() => {
    // Native page views draw above the app, so hide them while the dialog is up.
    setBrowserWebviewsSuspended(visible, "first-run-setup");
    return () => setBrowserWebviewsSuspended(false, "first-run-setup");
  }, [visible]);

  useEffect(() => {
    // The dialog is portaled outside #root, so the whole app behind it can go inert: no clicks,
    // hovers or keystrokes reach the tab sidebar, Space bar or title bar while setup is open.
    const root = document.getElementById("root");
    if (!visible || !root) return;
    root.setAttribute("inert", "");
    return () => root.removeAttribute("inert");
  }, [visible]);

  if (!visible) return null;
  const copy = stepCopy[steps[index]];
  return (
    <Dialog open>
      {/* Only Cancel leaves setup: clicking outside or pressing Escape must not. */}
      <DialogContent
        hideClose
        className="max-w-[560px] gap-0 p-7"
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
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
          {steps[index] === "tabs" ? <TabsStep /> : null}
          {steps[index] === "import" ? (
            <BrowserImportFlow onClose={next} closeLabel="Skip" />
          ) : null}
        </div>
        {steps[index] === "tabs" ? (
          <div className="mt-7 flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-cream-muted" onClick={finish}>
              Cancel
            </Button>
            <div className="ml-auto flex gap-2">
              {index > 0 ? (
                <Button variant="outline" onClick={() => setStep(steps[index - 1])}>
                  Back
                </Button>
              ) : null}
              <Button onClick={next}>{index === steps.length - 1 ? "Done" : "Continue"}</Button>
            </div>
          </div>
        ) : null}
        <p className="mt-4 text-xs text-cream-muted">You can change these anytime in Settings.</p>
      </DialogContent>
    </Dialog>
  );
}

function TabsStep() {
  const layout = useWindowDockingLayout();
  const setLayout = useWorkspaceStore((state) => state.setWindowDockingLayout);
  return (
    <div role="radiogroup" aria-label="Tab side" className="grid grid-cols-2 gap-3">
      {tabSideChoices.map((choice) => (
        <Choice
          key={choice.value}
          label={choice.label}
          selected={layout.tabs === choice.value}
          onSelect={() =>
            setLayout(normalizeDockingLayout({ navigation: layout.navigation, tabs: choice.value }))
          }
        >
          <TabsPreview side={choice.value} />
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
