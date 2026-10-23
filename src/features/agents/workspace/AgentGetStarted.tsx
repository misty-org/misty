import { useEffect, useState } from "react";
import { ChevronDown, Circle, CircleCheck } from "lucide-react";
import { Pressable } from "@/shared/ui";
import { observeAccountChanges } from "@/api/account-events";
import { onboardingApi, type OnboardingStep } from "@/api/assistant/onboarding";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { browserHomeUrl } from "@/features/workspace/browserHome";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { appsApi } from "../apps/api";
import { useMistyPanelStore } from "../panel/mistyPanelStore";

const collapsedKey = "misty:agent-get-started-collapsed";
// Open or closed is a per-device convenience; progress comes from the account itself.
const readCollapsed = () => {
  try {
    return localStorage.getItem(collapsedKey) === "1";
  } catch {
    return false;
  }
};
const writeCollapsed = (collapsed: boolean) => {
  try {
    if (collapsed) localStorage.setItem(collapsedKey, "1");
    else localStorage.removeItem(collapsedKey);
  } catch {
    // Storage is optional; the card still opens and closes for this session.
  }
};

/** Whether the account has connected an app, and the steps the server recorded; undefined
 * until known. */
function useAccountProgress(accountId: string) {
  const [apps, setApps] = useState<boolean>();
  const [steps, setSteps] = useState<OnboardingStep[]>();
  useEffect(() => {
    setApps(undefined);
    setSteps(undefined);
    if (!accountId) return;
    let current = true;
    const load = () =>
      Promise.all([
        appsApi
          .list()
          .then(({ apps }) => current && setApps(apps.some((app) => app.status === "active"))),
        onboardingApi.steps().then(({ steps }) => current && setSteps(steps)),
      ]).catch(() => undefined);
    // Also reruns when the window regains focus, as after connecting an app in the browser.
    const stop = observeAccountChanges(accountId, ["onboarding"], load);
    return () => {
      current = false;
      stop();
    };
  }, [accountId]);
  return { apps, steps };
}

/** A page to ask about, with Misty open beside it. */
const askOnPage = () => {
  useWorkspaceStore.getState().openBrowserView({ url: browserHomeUrl() });
  useMistyPanelStore.getState().setOpen(true);
};

/**
 * The first steps with agents, ticked off from what the account has actually done. It
 * sits at the foot of the sidebar and leaves once every step is done.
 */
export function AgentGetStarted({
  hasTask,
  disabled,
  onNewTask,
  onIntegrations,
  onWorkflows,
}: {
  hasTask: boolean;
  disabled: boolean;
  onNewTask(): void;
  onIntegrations(): void;
  onWorkflows(): void;
}) {
  const accountId = useMistyStore((state) => state.accountId);
  const { apps, steps: recorded } = useAccountProgress(accountId);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  // Shown once what's done is known, so finished steps never flash as open ones.
  if (apps === undefined || recorded === undefined) return null;
  const steps = [
    { label: "Run your first task", done: hasTask, onSelect: onNewTask },
    { label: "Ask an agent on any page", done: recorded.includes("page_ask"), onSelect: askOnPage },
    { label: "Connect an app", done: apps, onSelect: onIntegrations },
    { label: "Run a workflow", done: recorded.includes("workflow_run"), onSelect: onWorkflows },
  ];
  const remaining = steps.filter((step) => !step.done).length;
  if (!remaining) return null;
  const toggle = () => {
    writeCollapsed(!collapsed);
    setCollapsed(!collapsed);
  };
  return (
    <section className="agent-studio-get-started" aria-label="Get started">
      <Pressable
        className="agent-studio-get-started-header"
        aria-expanded={!collapsed}
        onClick={toggle}
      >
        <span>Get started</span>
        <span className="sr-only">
          , {remaining} of {steps.length} steps left
        </span>
        <ChevronDown aria-hidden="true" />
      </Pressable>
      {!collapsed && (
        <ul>
          {steps.map((step) => (
            <li key={step.label} data-done={step.done || undefined}>
              {step.done ? (
                <span className="agent-studio-get-started-step">
                  <CircleCheck aria-hidden="true" />
                  <span>{step.label}</span>
                  <span className="sr-only">, done</span>
                </span>
              ) : (
                <Pressable
                  className="agent-studio-get-started-step"
                  disabled={disabled}
                  onClick={step.onSelect}
                >
                  <Circle aria-hidden="true" />
                  <span>{step.label}</span>
                </Pressable>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
