import { Laptop } from "lucide-react";
import { Button } from "@/shared/ui";
import { SharedFoldersSection, useSharedFolders } from "../components/SharedFolders";
import { ConnectedAppsCatalog } from "./ConnectedAppsCatalog";
import "./integrationsApps.css";

/**
 * Everything an agent can reach, as one scrolling page: account apps, folders shared
 * from this computer, and the computer itself. The conversation only summarizes it.
 */
export function IntegrationsAppsPage({ onCompanion }: { onCompanion(): void }) {
  const shared = useSharedFolders();
  const device = shared.device;
  return (
    <div className="agent-integrations">
      <p className="agent-integrations-intro">
        What your agents can reach when you chat. Connected apps belong to your account and every
        agent can use them. Sends, shares, deletes and payments ask you first.
      </p>
      <ConnectedAppsCatalog />
      <SharedFoldersSection shared={shared} />
      {shared.available && (
        <section aria-labelledby="this-computer-heading" className="agent-integrations-section">
          <header>
            <h2 id="this-computer-heading">This computer</h2>
          </header>
          <div className="agent-integrations-list">
            <div className="agent-integrations-row">
              <Laptop size={18} aria-hidden="true" />
              <div className="agent-integrations-row-text">
                <strong>{device?.displayName || "Desktop companion"}</strong>
                <span>
                  {!device
                    ? "Not paired yet"
                    : device.status === "online"
                      ? "Online"
                      : device.status === "revoked"
                        ? "Access revoked"
                        : "Offline"}
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={onCompanion}>
                Companion settings
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
