import { reportSystemError, SystemErrorActivity } from "@/features/activity";
import { finishOnboarding } from "@/api/apps";
import { useAuth } from "@/features/auth";
import { useSpacesStore } from "@/features/spaces/core";
import { MistyBrandIcon, useNavigatorAppsStore } from "@/features/workspace/core";
import { Button, Checkbox, Input, Label, Separator } from "@/shared/ui";
import { errorText } from "@/shared/lib/format";
import { trackOnboardingCompleted } from "@/telemetry/lifecycle";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  CheckSquare2,
  MessageCircle,
  LockKeyhole,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import {
  accountNeedsOnboarding,
  clearAccountCreating,
  onboardingSpaceRoute,
  type OnboardingStarterApp,
} from "./onboardingState";

interface StarterApp {
  id: OnboardingStarterApp;
  label: string;
  description: string;
  icon: LucideIcon;
}

const starterApps: readonly StarterApp[] = [
  {
    id: "chat",
    label: "Chat",
    description: "Conversations with people and agents.",
    icon: MessageCircle,
  },
  {
    id: "journal",
    label: "Journal",
    description: "A focused place to think and write.",
    icon: BookOpenText,
  },
  {
    id: "planner",
    label: "Planner",
    description: "Tasks, agenda, and roadmaps.",
    icon: CheckSquare2,
  },
];

const defaultStarterApps = starterApps.map((app) => app.id);

export function OnboardingFlow() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { clearError, loadSpaces, snapshotReady, spaces } = useSpacesStore(
    useShallow((state) => ({
      clearError: state.clearError,
      loadSpaces: state.load,
      snapshotReady: state.snapshotReady,
      spaces: state.spaces,
    })),
  );
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [screen, setScreen] = useState<"space" | "apps">("space");
  const [spaceName, setSpaceName] = useState("");
  const [selectedApps, setSelectedApps] = useState<OnboardingStarterApp[]>(defaultStarterApps);
  const [working, setWorking] = useState(false);
  const [setupError, setSetupError] = useState("");

  const visible = accountNeedsOnboarding(user?.id, snapshotReady, spaces);

  useEffect(() => {
    setHost(
      document.querySelector<HTMLElement>("[data-misty-desktop-frame]") ??
        document.querySelector<HTMLElement>("[data-misty-mobile-frame]") ??
        document.querySelector<HTMLElement>("[data-misty-route-shell]") ??
        document.body,
    );
  }, []);

  useEffect(() => {
    setScreen("space");
    setSpaceName("");
    setSelectedApps(defaultStarterApps);
    setWorking(false);
    setSetupError("");
  }, [user?.id]);

  if (!visible || !host || !user) return null;

  const submitSpaceName = () => {
    if (!spaceName.trim()) return;
    clearError();
    setSetupError("");
    setScreen("apps");
  };

  const toggleApp = (appId: OnboardingStarterApp) => {
    setSelectedApps((current) => {
      if (current.includes(appId)) {
        return current.filter((id) => id !== appId);
      }
      const selected = new Set([...current, appId]);
      return starterApps.map((app) => app.id).filter((id) => selected.has(id));
    });
  };

  const finish = async () => {
    const name = spaceName.trim();
    if (!name || working) return;

    clearError();
    setSetupError("");
    setWorking(true);
    try {
      const completion = await finishOnboarding(name, selectedApps);
      const visibleStarterApps = new Set(selectedApps);
      useNavigatorAppsStore
        .getState()
        .setAppVisible(user.id, "social", visibleStarterApps.has("chat"));
      useNavigatorAppsStore
        .getState()
        .setAppVisible(user.id, "journal", visibleStarterApps.has("journal"));
      useNavigatorAppsStore
        .getState()
        .setAppVisible(user.id, "planner", visibleStarterApps.has("planner"));
      clearAccountCreating(user.id);
      await loadSpaces({ accountId: user.id, force: true });
      void trackOnboardingCompleted();
      navigate(onboardingSpaceRoute(completion.space.id), { replace: true });
    } catch (cause) {
      setSetupError(errorText(cause));
      reportSystemError({
        accountId: user.id,
        error: cause,
        scope: "onboarding:setup-space",
        title: "Space could not be set up",
      });
    } finally {
      setWorking(false);
    }
  };

  return createPortal(
    <section
      className="absolute inset-0 z-[80] overflow-y-auto bg-charcoal-bg text-cream"
      data-misty-onboarding
      aria-label="Set up Misty"
    >
      <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-10 sm:pt-9">
        <div className="flex items-center justify-center gap-2.5 text-sm font-medium text-cream-muted">
          <MistyBrandIcon size={22} />
          <span>Misty</span>
        </div>

        <div className="my-auto flex w-full justify-center py-12 sm:py-16">
          {screen === "space" ? (
            <form
              className="w-full max-w-[430px]"
              onSubmit={(event) => {
                event.preventDefault();
                submitSpaceName();
              }}
            >
              <OnboardingHeading
                title="What will this Space hold?"
                description="A Space keeps the notes, plans, files, and conversations for one part of your life together."
              />

              <div className="mt-10 grid gap-2">
                <Label htmlFor="onboarding-space-name">Space name</Label>
                <Input
                  id="onboarding-space-name"
                  className="h-11 px-3.5 text-cream placeholder:text-cream-faint"
                  value={spaceName}
                  onChange={(event) => setSpaceName(event.target.value)}
                  placeholder="Launch plan"
                  autoComplete="off"
                  autoFocus
                  maxLength={80}
                />
              </div>

              <p className="mt-4 flex items-center gap-2 text-xs leading-5 text-cream-muted">
                <LockKeyhole size={14} strokeWidth={1.7} aria-hidden="true" />
                Private to you until you invite someone.
              </p>

              <OnboardingActions>
                <Button
                  type="submit"
                  size="lg"
                  className="h-11 min-w-36"
                  disabled={!spaceName.trim()}
                >
                  Continue
                  <ArrowRight size={16} aria-hidden="true" />
                </Button>
              </OnboardingActions>
            </form>
          ) : (
            <div className="w-full max-w-[480px]">
              <OnboardingHeading
                title="Start with the apps you need"
                description="Keep the workspace calm. You can add or remove apps whenever your work changes."
              />

              <div className="mt-8 overflow-hidden rounded-lg border border-charcoal-border bg-charcoal-card/35">
                {starterApps.map((app, index) => (
                  <Fragment key={app.id}>
                    {index > 0 ? <Separator /> : null}
                    <StarterAppRow
                      app={app}
                      selected={selectedApps.includes(app.id)}
                      onToggle={() => toggleApp(app.id)}
                    />
                  </Fragment>
                ))}
              </div>

              <p className="mt-4 text-xs leading-5 text-cream-muted">
                These are only a starting point. You can continue without apps and install them
                later.
              </p>

              {setupError ? (
                <SystemErrorActivity
                  accountId={user.id}
                  body={setupError}
                  scope="onboarding:setup-space-store"
                  title="Space could not be set up"
                />
              ) : null}

              <OnboardingActions>
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  className="h-11 text-cream-muted"
                  onClick={() => {
                    clearError();
                    setScreen("space");
                  }}
                  disabled={working}
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                  Back
                </Button>
                <Button
                  type="button"
                  size="lg"
                  className="h-11 min-w-36"
                  onClick={() => void finish()}
                  disabled={working}
                >
                  {working ? "Finishing…" : "Finish setup"}
                  {!working ? <ArrowRight size={16} aria-hidden="true" /> : null}
                </Button>
              </OnboardingActions>
            </div>
          )}
        </div>
      </div>
    </section>,
    host,
  );
}

function OnboardingHeading({ title, description }: { title: string; description: string }) {
  return (
    <header className="text-center">
      <h1 className="text-[32px] font-semibold leading-tight tracking-tight text-cream sm:text-4xl">
        {title}
      </h1>
      <p className="mx-auto mt-4 max-w-[420px] text-[15px] leading-6 text-cream-muted">
        {description}
      </p>
    </header>
  );
}

function OnboardingActions({ children }: { children: ReactNode }) {
  return <div className="mt-9 flex items-center justify-center gap-3">{children}</div>;
}

function StarterAppRow({
  app,
  selected,
  onToggle,
}: {
  app: StarterApp;
  selected: boolean;
  onToggle: () => void;
}) {
  const Icon = app.icon;
  return (
    <label
      className="flex min-h-16 cursor-pointer items-center gap-3.5 px-3 py-3 text-left transition-colors hover:bg-charcoal-hover"
      htmlFor={`onboarding-app-${app.id}`}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-charcoal-hover text-cream-muted">
        <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-cream">{app.label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-cream-muted">{app.description}</span>
      </span>
      <Checkbox
        id={`onboarding-app-${app.id}`}
        checked={selected}
        onCheckedChange={onToggle}
        aria-label={`${selected ? "Remove" : "Add"} ${app.label}`}
      />
    </label>
  );
}
