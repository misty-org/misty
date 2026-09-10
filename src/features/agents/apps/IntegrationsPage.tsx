import { Laptop } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { Button } from "@/shared/ui";
import { CodeProjectsSection, useCodeProjects } from "../components/CodeProjects";
import { AgentMethodsCatalog } from "../workspace/AgentMethodsCatalog";
import { ConnectedAppsCatalog } from "./ConnectedAppsCatalog";
import "./integrationsApps.css";

type Section = "apps" | "skills" | "projects";

/**
 * Everything an agent can reach and do: account apps, its skills and projects on this
 * computer, one tab each. The conversation only summarizes it.
 */
export function IntegrationsPage({
  onCompanion,
  ...skills
}: { onCompanion(): void } & Omit<
  ComponentProps<typeof AgentMethodsCatalog>,
  "kind" | "embedded" | "children"
>) {
  const projects = useCodeProjects();
  const device = projects.device;
  const [chosen, setChosen] = useState<Section>("apps");
  // Projects exist only on the desktop.
  const sections: { value: Section; label: string }[] = [
    { value: "apps", label: "Apps" },
    { value: "skills", label: "Skills" },
    ...(projects.available ? [{ value: "projects" as const, label: "Projects" }] : []),
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
      <div className="agent-integrations-panel" hidden={section !== "projects"}>
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
        <CodeProjectsSection projects={projects} />
      </div>
    </div>
  );
}
