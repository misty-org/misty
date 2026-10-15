import { useState, type ComponentProps } from "react";
import { Button } from "@/shared/ui";
import { AgentMethodsCatalog } from "../workspace/AgentMethodsCatalog";
import { ConnectedAppsCatalog } from "./ConnectedAppsCatalog";
import "./integrationsApps.css";

type Section = "apps" | "skills";

/**
 * Everything an agent can reach and do: account apps and its skills, one tab each.
 * Projects are attached per chat from the composer's Project menu.
 */
export function IntegrationsPage(
  skills: Omit<ComponentProps<typeof AgentMethodsCatalog>, "kind" | "embedded" | "children">,
) {
  const [chosen, setChosen] = useState<Section>("apps");
  const sections: { value: Section; label: string }[] = [
    { value: "apps", label: "Apps" },
    { value: "skills", label: "Skills" },
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
    </div>
  );
}
