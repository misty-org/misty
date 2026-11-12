import { Blocks, Plug } from "lucide-react";
import { useState } from "react";
import { EngineConnectors } from "../marketplace/EngineConnectors";
import { EngineMarketplace } from "../marketplace/EngineMarketplace";
import { ChoiceGroup } from "@/shared/ui";
import { ConnectedAppsCatalog } from "./ConnectedAppsCatalog";

type View = "plugins" | "apps";

/**
 * What agents can reach: each engine's own plugins, and the apps they sign in to. The page has no
 * heading, and its content starts a top bar's height down, clear of the window's own controls at
 * the top edge.
 */
export function IntegrationsPage() {
  const [view, setView] = useState<View>("plugins");
  return (
    <div className="@container mx-auto grid w-full max-w-5xl gap-6 px-4 pb-8 pt-(--ui-header)">
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
