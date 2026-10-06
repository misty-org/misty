import { Laptop } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { Button } from "@/shared/ui";
import { SharedFoldersSection, useSharedFolders } from "../components/SharedFolders";
import { AgentMethodsCatalog } from "../workspace/AgentMethodsCatalog";
import { ConnectedAppsCatalog } from "./ConnectedAppsCatalog";
import "./integrationsApps.css";

type Section = "apps" | "skills" | "folders" | "computer";

/**
 * Everything an agent can reach and do: account apps, its skills, folders shared from this
 * computer, and the computer itself, one tab each. The conversation only summarizes it.
 */
export function IntegrationsPage({
  onCompanion,
  ...skills
}: { onCompanion(): void } & Omit<
  ComponentProps<typeof AgentMethodsCatalog>,
  "kind" | "embedded" | "children"
>) {
  const shared = useSharedFolders();
  const device = shared.device;
  const [chosen, setChosen] = useState<Section>("apps");
  // Folders and the computer exist only on the desktop.
  const sections: { value: Section; label: string }[] = [
    { value: "apps", label: "Apps" },
    { value: "skills", label: "Skills" },
    ...(shared.available
      ? [
          { value: "folders" as const, label: "Shared folders" },
          { value: "computer" as const, label: "This computer" },
        ]
      : []),
  ];
  const section = sections.some((s) => s.value === chosen) ? chosen : "apps";
  return (
    <div className="agent-studio-workflows agent-integrations">
      <header className="agent-studio-heading">
        <div>
          <h1>Integrations</h1>
          <p>
            What your agents can reach when you chat. Connected apps belong to your account and
            every agent can use them. Sends, shares, deletes and payments ask you first.
          </p>
        </div>
      </header>
      <div role="navigation" aria-label="Integration areas" className="flex w-fit gap-1.5">
        {sections.map((option) => (
          <Button
            key={option.value}
            variant="chip"
            size="sm"
            className="font-normal"
            aria-pressed={section === option.value}
            onClick={() => setChosen(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {/* Tabs stay mounted so switching never reloads them or loses a sign-in in progress. */}
      <div className="agent-integrations-panel" hidden={section !== "apps"}>
        <ConnectedAppsCatalog />
      </div>
      <div className="agent-integrations-panel" hidden={section !== "skills"}>
        <AgentMethodsCatalog {...skills} kind="skill" embedded />
      </div>
      <div className="agent-integrations-panel" hidden={section !== "folders"}>
        <SharedFoldersSection shared={shared} />
      </div>
      {shared.available && (
        <div className="agent-integrations-panel" hidden={section !== "computer"}>
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
        </div>
      )}
    </div>
  );
}
