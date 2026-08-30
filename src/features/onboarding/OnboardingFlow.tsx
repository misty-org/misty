import { aiSurfaceApi } from "@/features/ai-surface";
import { reportSystemError, SystemErrorActivity } from "@/features/activity";
import { useAuth } from "@/features/auth";
import { setBrowserWebviewsSuspended } from "@/features/browser";
import { useSpacesStore } from "@/features/spaces";
import mistyOrb from "@/shared/assets/mist-orb-expression-cycle.webp";
import { cn } from "@/shared/ui";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Bot,
  Check,
  CheckSquare2,
  Compass,
  Library,
  MessagesSquare,
  Rocket,
  ShieldCheck,
  Plus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import {
  onboardingStartRoute,
  readOnboardingCompletion,
  suggestedSpaceName,
  writeOnboardingCompletion,
  type OnboardingPurpose,
  type OnboardingStart,
} from "./onboardingState";
import { trackOnboardingCompleted } from "@/telemetry/lifecycle";
import { ChoiceGrid, OnboardingStep, SelectionCard } from "./OnboardingPrimitives";

const steps = ["Welcome", "Space", "First step", "Privacy"] as const;

const purposes: Array<{
  id: OnboardingPurpose;
  title: string;
  detail: string;
  icon: LucideIcon;
}> = [
  {
    id: "plan",
    title: "Plan and finish projects",
    detail: "Turn ideas into clear tasks and next steps.",
    icon: Rocket,
  },
  {
    id: "organize",
    title: "Organize what matters",
    detail: "Keep notes, files, and knowledge together.",
    icon: BookOpenText,
  },
  {
    id: "collaborate",
    title: "Work with other people",
    detail: "Share context, decisions, and progress in one Space.",
    icon: Users,
  },
  {
    id: "explore",
    title: "Explore Misty",
    detail: "Start simple and discover the tools as you go.",
    icon: Compass,
  },
];

const starts: Array<{
  id: OnboardingStart;
  title: string;
  detail: string;
  icon: LucideIcon;
}> = [
  {
    id: "note",
    title: "Write a note",
    detail: "Capture an idea while it is fresh.",
    icon: BookOpenText,
  },
  {
    id: "task",
    title: "Plan a task",
    detail: "Give your next action a clear home.",
    icon: CheckSquare2,
  },
  {
    id: "social",
    title: "Start a conversation",
    detail: "Bring people and context together.",
    icon: MessagesSquare,
  },
  {
    id: "library",
    title: "Add to your Library",
    detail: "Keep useful files close to the work.",
    icon: Library,
  },
];

export function OnboardingFlow() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { spaces, snapshotReady, limits, createSpace, storeError, clearError } = useSpacesStore(
    useShallow((state) => ({
      spaces: state.spaces,
      snapshotReady: state.snapshotReady,
      limits: state.limits,
      createSpace: state.createSpace,
      storeError: state.error,
      clearError: state.clearError,
    })),
  );
  const [dismissedAccountId, setDismissedAccountId] = useState("");
  const [step, setStep] = useState(0);
  const [purpose, setPurpose] = useState<OnboardingPurpose | null>(null);
  const [spaceMode, setSpaceMode] = useState<"existing" | "new">("existing");
  const [selectedSpaceId, setSelectedSpaceId] = useState("");
  const [spaceName, setSpaceName] = useState("");
  const [start, setStart] = useState<OnboardingStart>("note");
  const [hostedAiEnabled, setHostedAiEnabled] = useState(true);
  const [working, setWorking] = useState(false);

  const accountId = user?.id ?? "";
  const completed = accountId ? readOnboardingCompletion(accountId) : null;
  const visible = Boolean(
    accountId && snapshotReady && !completed && dismissedAccountId !== accountId,
  );
  const canCreateSpace = !limits || limits.unlimited_spaces || spaces.length < limits.space_limit;

  useEffect(() => {
    if (!accountId || !snapshotReady) return;
    setSelectedSpaceId((current) =>
      current && spaces.some((space) => space.id === current) ? current : (spaces[0]?.id ?? ""),
    );
    if (!spaces.length) setSpaceMode("new");
  }, [accountId, snapshotReady, spaces]);

  useEffect(() => {
    if (!visible) return;
    setBrowserWebviewsSuspended(true, "onboarding");
    return () => setBrowserWebviewsSuspended(false, "onboarding");
  }, [visible]);

  const firstName = useMemo(() => user?.name.trim().split(/\s+/)[0] || "there", [user?.name]);

  if (!visible || !user) return null;

  const finish = async () => {
    if (working) return;
    setWorking(true);
    clearError();
    try {
      let spaceId = selectedSpaceId || spaces[0]?.id || "";
      if (spaceMode === "new" || !spaceId) {
        const name = spaceName.trim() || suggestedSpaceName(purpose ?? "explore");
        const created = await createSpace({
          name,
          template_id: "blank",
          integration_providers: [],
        });
        spaceId = created.space.id;
      }

      if (!hostedAiEnabled) {
        const { settings } = await aiSurfaceApi.settings();
        if (settings.enabled) {
          await aiSurfaceApi.updateSettings(false, settings.retention_days);
        }
      }

      writeOnboardingCompletion(user.id, {
        outcome: "completed",
        purpose: purpose ?? "explore",
        start,
        hostedAiEnabled,
      });
      setDismissedAccountId(user.id);
      void trackOnboardingCompleted();
      navigate(onboardingStartRoute(spaceId, start));
    } catch (cause) {
      reportSystemError({
        accountId: user.id,
        error: cause,
        scope: "onboarding:finish",
        title: "Setup could not be completed",
      });
    } finally {
      setWorking(false);
    }
  };

  const skip = () => {
    writeOnboardingCompletion(user.id, { outcome: "skipped" });
    setDismissedAccountId(user.id);
    void trackOnboardingCompleted();
  };

  const nextDisabled =
    (step === 0 && !purpose) ||
    (step === 1 &&
      ((spaceMode === "existing" && !selectedSpaceId) ||
        (spaceMode === "new" && (!canCreateSpace || !spaceName.trim()))));

  return (
    <div
      className="fixed inset-0 z-[2147483600] grid place-items-center overflow-auto bg-[#090b0d]/95 p-4 text-cream backdrop-blur-xl sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="misty-onboarding-title"
      data-misty-onboarding
    >
      <div
        className={cn(
          "relative grid min-h-[620px] w-full max-w-[920px] overflow-hidden rounded-[28px]",
          "border border-white/10 bg-charcoal-bg shadow-[0_32px_120px_rgba(0,0,0,0.7)]",
          "md:grid-cols-[230px_minmax(0,1fr)]",
        )}
      >
        <aside
          className={cn(
            "relative overflow-hidden border-b border-white/10 p-6 md:border-b-0 md:border-r",
            "bg-[radial-gradient(circle_at_30%_0%,rgba(119,147,255,0.22),transparent_52%)]",
          )}
        >
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl border border-white/10 bg-white/5">
              <img src={mistyOrb} alt="" className="size-8 object-contain" draggable={false} />
            </span>
            <div>
              <p className="m-0 text-[11px] font-semibold text-cream-muted">Welcome to</p>
              <p className="m-0 text-lg font-semibold text-cream-bright">Misty</p>
            </div>
          </div>

          <ol className="mt-8 grid grid-cols-4 gap-2 md:mt-14 md:grid-cols-1 md:gap-3">
            {steps.map((label, index) => (
              <li key={label} className="flex min-w-0 items-center gap-3">
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full border text-[11px] font-semibold transition-colors",
                    index < step
                      ? "border-sage-fg/40 bg-sage-fg/15 text-sage-fg"
                      : index === step
                        ? "border-cream/30 bg-cream/10 text-cream-bright"
                        : "border-white/10 text-cream-muted/60",
                  )}
                  aria-current={index === step ? "step" : undefined}
                >
                  {index < step ? <Check size={13} /> : index + 1}
                </span>
                <span className="hidden truncate text-xs text-cream-muted md:block">{label}</span>
              </li>
            ))}
          </ol>

          <p className="mt-8 hidden text-[11px] leading-5 text-cream-muted/70 md:block">
            About two minutes. Every choice can be changed later.
          </p>
        </aside>

        <section className="flex min-h-0 flex-col p-6 sm:p-9">
          <div className="min-h-0 flex-1">
            {step === 0 ? (
              <OnboardingStep
                eyebrow={`Hi ${firstName}`}
                title="What would you like Misty to help with first?"
                detail="We’ll use this only to shape your starting point. It won’t lock you into a workflow."
              >
                <ChoiceGrid
                  choices={purposes}
                  value={purpose}
                  onChange={(value) => {
                    setPurpose(value);
                    if (!spaceName) setSpaceName(suggestedSpaceName(value));
                  }}
                />
              </OnboardingStep>
            ) : null}

            {step === 1 ? (
              <OnboardingStep
                eyebrow="Your workspace"
                title="Choose a Space to begin in"
                detail="A Space keeps related notes, plans, conversations, and files together. It starts private to you until you invite someone."
              >
                <div className="grid gap-3">
                  {spaces.slice(0, 6).map((space) => (
                    <SelectionCard
                      key={space.id}
                      selected={spaceMode === "existing" && selectedSpaceId === space.id}
                      title={space.name}
                      detail="Use this existing Space"
                      icon={BookOpenText}
                      onClick={() => {
                        setSpaceMode("existing");
                        setSelectedSpaceId(space.id);
                      }}
                    />
                  ))}
                  <SelectionCard
                    selected={spaceMode === "new"}
                    title="Create a new Space"
                    detail={
                      canCreateSpace
                        ? "Start with a clean, private Space"
                        : "Your current plan’s Space limit is reached"
                    }
                    icon={Plus}
                    disabled={!canCreateSpace}
                    onClick={() => setSpaceMode("new")}
                  />
                  {spaceMode === "new" ? (
                    <label className="mt-1 grid gap-2 text-xs font-medium text-cream-muted">
                      Space name
                      <input
                        autoFocus
                        className={cn(
                          "h-11 rounded-xl border border-white/10 bg-charcoal-card px-3 text-sm",
                          "text-cream-bright outline-none transition focus:border-cream/30",
                          "focus:ring-2 focus:ring-cream/10",
                        )}
                        value={spaceName}
                        maxLength={80}
                        onChange={(event) => setSpaceName(event.target.value)}
                        placeholder="My Space"
                      />
                    </label>
                  ) : null}
                </div>
              </OnboardingStep>
            ) : null}

            {step === 2 ? (
              <OnboardingStep
                eyebrow="Make it real"
                title="What do you want to do first?"
                detail="When setup closes, Misty will take you directly there and open the first action for you."
              >
                <ChoiceGrid choices={starts} value={start} onChange={setStart} />
              </OnboardingStep>
            ) : null}

            {step === 3 ? (
              <OnboardingStep
                eyebrow="You stay in control"
                title="Choose how you want to start with Misty AI"
                detail="Core Spaces, notes, planning, and files work without hosted AI. You can change this later in Settings → Misty."
              >
                <div className="grid gap-3">
                  <SelectionCard
                    selected={hostedAiEnabled}
                    title="Use Misty when I ask"
                    detail="Recommended. Misty starts with the surface you’re using and context you explicitly attach. Proactive suggestions remain off."
                    icon={Bot}
                    onClick={() => setHostedAiEnabled(true)}
                  />
                  <SelectionCard
                    selected={!hostedAiEnabled}
                    title="Start without hosted AI"
                    detail="Keep the core productivity tools available and turn Misty AI on later."
                    icon={ShieldCheck}
                    onClick={() => setHostedAiEnabled(false)}
                  />
                </div>
                <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.025] p-4 text-xs leading-5 text-cream-muted">
                  Misty never silently shares personal corrections or rankings with a Space.
                  Destructive, external, and permission-changing actions still require exact review.
                </div>
              </OnboardingStep>
            ) : null}
          </div>

          {storeError ? (
            <SystemErrorActivity
              accountId={user.id}
              error={storeError}
              scope="onboarding:spaces"
              title="Spaces could not be prepared for setup"
            />
          ) : null}

          <footer className="flex items-center justify-between gap-3 border-t border-white/10 pt-5">
            <button
              type="button"
              className={cn(
                "rounded-lg px-2 py-2 text-xs text-cream-muted transition hover:text-cream-bright",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream/20",
              )}
              onClick={skip}
            >
              Skip for now
            </button>
            <div className="flex items-center gap-2">
              {step > 0 ? (
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-10 items-center gap-2 rounded-xl border border-white/10",
                    "px-4 text-sm text-cream transition hover:bg-white/5",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream/20",
                  )}
                  onClick={() => setStep((current) => Math.max(0, current - 1))}
                >
                  <ArrowLeft size={15} /> Back
                </button>
              ) : null}
              <button
                type="button"
                className={cn(
                  "inline-flex h-10 items-center gap-2 rounded-xl bg-cream-bright px-4 text-sm",
                  "font-semibold text-charcoal-bg transition hover:bg-white",
                  "disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none",
                  "focus-visible:ring-2 focus-visible:ring-white/40",
                )}
                disabled={nextDisabled || working}
                onClick={() => {
                  if (step < steps.length - 1) setStep((current) => current + 1);
                  else void finish();
                }}
              >
                {step === steps.length - 1
                  ? working
                    ? "Finishing…"
                    : "Start using Misty"
                  : "Continue"}
                {step === steps.length - 1 ? <Check size={15} /> : <ArrowRight size={15} />}
              </button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
