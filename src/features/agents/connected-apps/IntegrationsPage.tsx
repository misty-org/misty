import { Blocks, Plug } from "lucide-react";
import { EngineConnectors } from "../marketplace/EngineConnectors";
import { EngineMarketplace } from "../marketplace/EngineMarketplace";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import { ChoiceGroup } from "@/shared/ui";
import { ConnectedAppsCatalog } from "./ConnectedAppsCatalog";

type View = "plugins" | "apps";

/** The half of the page the person last chose, kept for this device in `misty.db`. */
const useIntegrationsView = createDeviceSetting<View>({
  scope: "integrations-view",
  defaults: "plugins",
  normalize: (stored) => (stored === "apps" ? "apps" : "plugins"),
});

/**
 * What agents can reach: each engine's own plugins, and the apps they sign in to. The page has no
 * heading, and its content starts a top bar's height down, clear of the window's own controls at
 * the top edge.
 */
export function IntegrationsPage() {
  const view = useIntegrationsView((state) => state.value);
  const setView = (next: View) => useIntegrationsView.getState().set(next);
  return (
    <div className="@container mx-auto grid w-full max-w-6xl gap-6 px-4 pb-8 pt-(--ui-header)">
      <span data-tour="integrations-tabs" className="contents">
        <ChoiceGroup
          label="Integrations"
          value={view}
          onChange={setView}
          options={[
            { value: "plugins", label: "Plugins", icon: Blocks },
            { value: "apps", label: "Apps", icon: Plug },
          ]}
          className="justify-self-start"
        />
      </span>
      {view === "plugins" ? (
        <EngineMarketplace />
      ) : (
        <div className="grid gap-8">
          <EngineConnectors />
          <ConnectedAppsCatalog />
        </div>
      )}
    </div>
  );
}
