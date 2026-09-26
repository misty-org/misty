import { useAuth } from "@/features/auth";
import { useEffect } from "react";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { TOUR_TARGET_SELECTORS, type TourStepConfig } from "./types";
import { useTourStore } from "./useTourStore";
import { TourWelcomeModal } from "./TourWelcomeModal";
import { TourCompleteModal } from "./TourCompleteModal";
import { TourOverlay } from "./TourOverlay";
import { TourPopover } from "./TourPopover";

const steps: TourStepConfig[] = [
  {
    id: "navigation",
    targetSelector: TOUR_TARGET_SELECTORS.navigation,
    title: "Your browser workspace",
    description:
      "Open Home to browse, Search to enter a URL or search Google, and Agents to work with AI.",
    actionHint: "Use ⌘K on Mac or Ctrl+K on Windows to open Search from anywhere.",
  },
  {
    id: "website-groups",
    targetSelector: TOUR_TARGET_SELECTORS.websiteGroups,
    title: "Keep your websites together",
    description:
      "Save websites under the names in the navbar. Use each dropdown to switch websites, and the arrow beside it to show your pins.",
    actionHint: "Use New group for your own collection, or Save to group to keep the current page.",
  },
  {
    id: "canvas-tabs",
    targetSelector: TOUR_TARGET_SELECTORS.canvasTabs,
    title: "Tabs and splits",
    description:
      "Open tabs and arrange pages side by side. Each layout keeps its own set of panes so you can return to the arrangement you need.",
  },
  {
    id: "virtual-windows",
    targetSelector: TOUR_TARGET_SELECTORS.virtualWindows,
    title: "Separate your work",
    description:
      "Create virtual windows for different projects. Switch windows to return to their tabs and layouts.",
    actionHint: "Device sync is a preview in Settings. Website sign-ins do not transfer yet.",
  },
];

export function AppTour() {
  const { user, transitioning } = useAuth();
  const isOpen = useTourStore((state) => state.isOpen);
  const currentStep = useTourStore((state) => state.currentStep);
  const setStep = useTourStore((state) => state.setStep);
  const nextStep = useTourStore((state) => state.nextStep);
  const prevStep = useTourStore((state) => state.prevStep);
  const skipTour = useTourStore((state) => state.skipTour);
  const finishTour = useTourStore((state) => state.finishTour);
  const visible = isOpen && !transitioning && Boolean(user?.id) && currentStep !== "closed";

  useEffect(() => {
    setBrowserWebviewsSuspended(visible, "workspace-tour");
    return () => setBrowserWebviewsSuspended(false, "workspace-tour");
  }, [visible]);

  if (!visible) return null;
  if (currentStep === "welcome")
    return (
      <TourWelcomeModal onStart={() => setStep("navigation")} onSkip={() => skipTour(user?.id)} />
    );
  if (currentStep === "complete")
    return <TourCompleteModal onFinish={() => finishTour(user?.id)} />;
  const index = steps.findIndex((step) => step.id === currentStep);
  const step = steps[index];
  if (!step) return null;
  return (
    <>
      <TourOverlay targetSelector={step.targetSelector} />
      <TourPopover
        stepNumber={index + 1}
        totalSteps={steps.length}
        title={step.title}
        description={step.description}
        actionHint={step.actionHint}
        targetSelector={step.targetSelector}
        showBack
        primaryLabel={index === steps.length - 1 ? "Finish tour" : "Next"}
        onNext={nextStep}
        onBack={prevStep}
        onSkip={() => skipTour(user?.id)}
      />
    </>
  );
}
