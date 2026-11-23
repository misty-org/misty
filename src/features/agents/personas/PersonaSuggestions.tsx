// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { Check } from "lucide-react";
import { useState, type PointerEvent } from "react";
import { Button } from "@misty/ui";
import { filterItems } from "../conversations/composer/controls/composer_triggers";
import { enabledPersonas, makeAgentFromPersona, personaToken } from "./catalog_api";

export async function personaSuggestions(query: string) {
  const personas = await enabledPersonas().catch(() => []);
  const items = personas.map((persona) => ({
    key: `persona:${persona.id}`,
    name: personaToken(persona.id),
    label: persona.name,
    description: `${persona.icon ? `${persona.icon} ` : ""}${persona.description}`,
    insert: `#${personaToken(persona.id)} `,
    icon: "persona" as const,
    persona: persona.id,
  }));
  const words = query.toLowerCase();
  const byName = items.filter((item) => item.label.toLowerCase().includes(words));
  const matched = filterItems(items, query);
  const seen = new Set(matched.map((item) => item.key));
  return [...matched, ...byName.filter((item) => !seen.has(item.key))].slice(0, 30);
}

export function PersonaMakeAgent({ id }: { id: string }) {
  const [state, setState] = useState<"idle" | "working" | "made" | "failed">("idle");
  const make = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (state === "working" || state === "made") return;
    setState("working");
    makeAgentFromPersona(id).then(
      () => setState("made"),
      () => setState("failed"),
    );
  };
  return (
    <Button
      variant="quiet"
      size="sm"
      className="shrink-0 text-micro"
      onPointerDown={make}
      disabled={state === "working"}
    >
      {state === "made" ? (
        <span className="inline-flex items-center gap-1">
          <Check aria-hidden />
          Agent made
        </span>
      ) : state === "failed" ? (
        "Couldn't make it. Try again"
      ) : (
        "Make an agent from this"
      )}
    </Button>
  );
}
