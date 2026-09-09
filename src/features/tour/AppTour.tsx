import { useAuth } from "@/features/auth";
import { routes } from "@/features/app-shell";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { TOUR_TARGET_SELECTORS } from "./types";
import { useTourStore } from "./useTourStore";
import { TourWelcomeModal } from "./TourWelcomeModal";
import { TourCompleteModal } from "./TourCompleteModal";
import { TourOverlay } from "./TourOverlay";
import { TourPopover } from "./TourPopover";
import { TourMockStoreCard } from "./TourMockStoreCard";

export function AppTour() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isOpen = useTourStore((state) => state.isOpen);
  const currentStep = useTourStore((state) => state.currentStep);
  const setStep = useTourStore((state) => state.setStep);
  const nextStep = useTourStore((state) => state.nextStep);
  const prevStep = useTourStore((state) => state.prevStep);
  const skipTour = useTourStore((state) => state.skipTour);
  const finishTour = useTourStore((state) => state.finishTour);

  useEffect(() => {
    if (!isOpen) return;

    if (currentStep === "store-explore") {
      if (!location.pathname.startsWith(routes.discover)) {
        navigate(routes.discover);
      }
    } else if (
      currentStep === "canvas-tabs" ||
      currentStep === "virtual-windows" ||
      currentStep === "space-share"
    ) {
      if (location.pathname.startsWith(routes.discover)) {
        navigate(routes.spaces);
      }
    }
  }, [currentStep, isOpen, location.pathname, navigate]);

  if (!isOpen || currentStep === "closed") {
    return null;
  }

  if (currentStep === "welcome") {
    return (
      <TourWelcomeModal onStart={() => setStep("navigation")} onSkip={() => skipTour(user?.id)} />
    );
  }

  if (currentStep === "complete") {
    return <TourCompleteModal onFinish={() => finishTour(user?.id)} />;
  }

  return (
    <>
      {currentStep === "navigation" && (
        <>
          <TourOverlay targetSelector={TOUR_TARGET_SELECTORS.navigation} />
          <TourPopover
            stepNumber={1}
            totalSteps={7}
            title="Navigation Rail"
            description="Your Spaces, personal tools (Files, Browser), and AI collaborators live in this quiet navigation rail. Switch between contexts without cluttering your screen."
            actionHint="Look down the left edge to see the top-level sections."
            primaryLabel="Next"
            targetSelector={TOUR_TARGET_SELECTORS.navigation}
            onNext={nextStep}
            onSkip={() => skipTour(user?.id)}
          />
        </>
      )}

      {currentStep === "apps-toggle" && (
        <>
          <TourOverlay targetSelector={TOUR_TARGET_SELECTORS.appsToggle} />
          <TourPopover
            stepNumber={2}
            totalSteps={7}
            title="Toggling Apps to the Navbar"
            description="Click the + button next to Apps to pin or unpin starter tools (Chat, Journal, Planner). Toggling lets you keep only the tools you actively need in your rail."
            actionHint="Clicking this button reveals the app toggle drawer."
            showBack
            primaryLabel="Next"
            targetSelector={TOUR_TARGET_SELECTORS.appsToggle}
            onNext={nextStep}
            onBack={prevStep}
            onSkip={() => skipTour(user?.id)}
          />
        </>
      )}

      {currentStep === "apps-browse" && (
        <>
          <TourOverlay targetSelector={TOUR_TARGET_SELECTORS.appsBrowse} />
          <TourPopover
            stepNumber={3}
            totalSteps={7}
            title="Discovering & Browsing Apps"
            description="Want more tools, MCP servers, or extensions? Clicking 'Browse apps' opens the Misty Store where you can discover and install additional capabilities."
            actionHint="Next, we'll take you to the Store to see how installations work."
            showBack
            primaryLabel="Go to Store"
            targetSelector={TOUR_TARGET_SELECTORS.appsBrowse}
            onNext={nextStep}
            onBack={prevStep}
            onSkip={() => skipTour(user?.id)}
          />
        </>
      )}

      {currentStep === "store-explore" && (
        <>
          <TourOverlay targetSelector={TOUR_TARGET_SELECTORS.storeExplore} />
          <TourPopover
            stepNumber={4}
            totalSteps={7}
            title="Misty Store & App Installation"
            description="Browse curated tools and community integrations. In this sandbox preview, you can test-install mock extensions with zero real downloads."
            showBack
            primaryLabel="Next: Workspace Canvas"
            targetSelector={TOUR_TARGET_SELECTORS.storeExplore}
            onNext={nextStep}
            onBack={prevStep}
            onSkip={() => skipTour(user?.id)}
          >
            <TourMockStoreCard />
          </TourPopover>
        </>
      )}

      {currentStep === "canvas-tabs" && (
        <>
          <TourOverlay targetSelector={TOUR_TARGET_SELECTORS.canvasTabs} />
          <TourPopover
            stepNumber={5}
            totalSteps={7}
            title="Panels, Tabs & Splits"
            description="Your workspace canvas arranges work flexibly: open multiple tabs side-by-side, split panes horizontally or vertically, and drag tabs between panels to build your ideal setup."
            actionHint="Each tab keeps its live state intact so you never lose your context."
            showBack
            primaryLabel="Next"
            targetSelector={TOUR_TARGET_SELECTORS.canvasTabs}
            onNext={nextStep}
            onBack={prevStep}
            onSkip={() => skipTour(user?.id)}
          />
        </>
      )}

      {currentStep === "virtual-windows" && (
        <>
          <TourOverlay targetSelector={TOUR_TARGET_SELECTORS.virtualWindows} />
          <TourPopover
            stepNumber={6}
            totalSteps={7}
            title="Virtual Windows"
            description="Organize separate work streams within the same Space using virtual windows. Switch between research, coding, or planning without mixing up your tabs."
            actionHint="Click the window icon anytime to create and switch windows."
            showBack
            primaryLabel="Next"
            targetSelector={TOUR_TARGET_SELECTORS.virtualWindows}
            onNext={nextStep}
            onBack={prevStep}
            onSkip={() => skipTour(user?.id)}
          />
        </>
      )}

      {currentStep === "space-share" && (
        <>
          <TourOverlay targetSelector={TOUR_TARGET_SELECTORS.spaceShare} />
          <TourPopover
            stepNumber={7}
            totalSteps={7}
            title="Sharing Your Space"
            description="Collaborate seamlessly: invite teammates into your Space, generate share links, and configure role-based permissions directly from the Space header."
            actionHint="Spaces are private by default until you choose to invite someone."
            showBack
            primaryLabel="Finish tour"
            targetSelector={TOUR_TARGET_SELECTORS.spaceShare}
            onNext={nextStep}
            onBack={prevStep}
            onSkip={() => skipTour(user?.id)}
          />
        </>
      )}
    </>
  );
}
