import { ConnectedAppsCatalog } from "./ConnectedAppsCatalog";
import "./integrationsApps.css";

/** The apps agents can reach, connected once for every agent. The page has no heading. */
export function IntegrationsPage() {
  return (
    <div className="agent-studio-catalog-page agent-integrations">
      <ConnectedAppsCatalog />
    </div>
  );
}
