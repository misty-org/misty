import { useAuth } from "@/features/auth";
import {
  NAVIGATOR_APP_DESCRIPTIONS,
  WORKSPACE_TOOLS_META,
  WorkspaceAppIcon,
  navigatorAppIdsForAccount,
  useNavigatorAppsStore,
  type NavigatorAppId,
} from "@/features/workspace";
import { Checkbox, Button } from "@/shared/ui";

const TOUR_APP_IDS: NavigatorAppId[] = ["social", "journal", "planner", "files", "browser"];

export function TourAppsPanel(props: {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const { user } = useAuth();
  const accountId = user?.id ?? "";
  const pinnedAppIds = useNavigatorAppsStore((state) =>
    navigatorAppIdsForAccount(state, accountId),
  );
  const setAppVisible = useNavigatorAppsStore((state) => state.setAppVisible);

  const toggleApp = (id: NavigatorAppId) => {
    const isPinned = pinnedAppIds.includes(id);
    setAppVisible(accountId, id, !isPinned);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="flex flex-col md:flex-row items-center gap-6 max-w-2xl w-full">
        {/* Spotlighted Apps Panel */}
        <div
          className="w-full max-w-sm rounded-xl border border-[#d4a359] bg-[#171717] p-5 shadow-2xl transition-all"
          style={{
            boxShadow: "0 0 0 1.5px #d4a359, 0 0 24px 2px rgba(212, 163, 89, 0.4)",
          }}
        >
          <div className="border-b border-[#292929] pb-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-cream-muted">
              Add Apps to Workspace
            </h4>
            <p className="mt-1 text-xs text-cream-faint">
              Toggle only the tools your current work requires.
            </p>
          </div>

          <div className="mt-3 divide-y divide-[#222]">
            {TOUR_APP_IDS.map((id) => {
              const meta = WORKSPACE_TOOLS_META[id];
              const description = NAVIGATOR_APP_DESCRIPTIONS[id];
              const isChecked = pinnedAppIds.includes(id);

              return (
                <label
                  key={id}
                  className="flex cursor-pointer items-center justify-between py-2.5 px-1 hover:bg-[#1f1f1f] rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <WorkspaceAppIcon appId={id} size="picker" className="text-cream-muted" />
                    <div>
                      <span className="block text-xs font-medium text-cream">{meta?.label ?? id}</span>
                      <span className="block text-[11px] text-cream-faint">
                        {description}
                      </span>
                    </div>
                  </div>

                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggleApp(id)}
                    aria-label={`Enable ${meta?.label ?? id}`}
                  />
                </label>
              );
            })}
          </div>
        </div>

        {/* Step 2 Guidance Popover */}
        <div className="w-full max-w-xs rounded-xl border border-charcoal-border bg-[#1c1c1c] p-5 shadow-2xl">
          <div className="flex items-center justify-between text-[11px] font-mono text-cream-faint">
            <span>2 / 3</span>
            <button
              type="button"
              className="text-xs text-cream-faint hover:text-cream-bright"
              onClick={props.onSkip}
            >
              Skip
            </button>
          </div>

          <div className="mt-3">
            <h3 className="text-base font-semibold text-cream-bright">Add Apps Explicitly</h3>
            <p className="mt-2 text-xs leading-5 text-cream-muted">
              Keep your workspace calm and focused. Explicitly select only the tools you need right
              now, and add or remove apps anytime.
            </p>
          </div>

          <div className="mt-6 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-xs text-cream-muted hover:text-cream-bright"
              onClick={props.onBack}
            >
              Back
            </Button>

            <Button
              type="button"
              size="sm"
              className="h-8 min-w-[76px] bg-[#a3bfab] px-3.5 text-xs font-medium text-[#111] hover:bg-[#b5cfbc]"
              onClick={props.onNext}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
