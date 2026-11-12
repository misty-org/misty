import { ConnectedAppsCatalog } from "./ConnectedAppsCatalog";
import "./integrationsApps.css";

/**
 * The apps agents can reach, connected once for every agent. The page has no heading, and its
 * content starts a top bar's height down, clear of the window's own controls at the top edge.
 */
export function IntegrationsPage() {
  return (
    <div className="agent-studio-catalog-page agent-integrations">
      <ConnectedAppsCatalog />
    </div>
  );
}
