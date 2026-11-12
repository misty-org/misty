// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
/**
 * The composer's `#` menu: personas from the bundled catalog. Picking one puts `#token` in the
 * message, and the run takes that persona's prompt as instructions for this message. The row in
 * focus also offers to make one of the person's own agents from the persona.
 */
import { Check } from "lucide-react";
import { useState, type PointerEvent } from "react";
import { Button } from "@/shared/ui";
import { filterItems } from "../conversations/composer/controls/composerTriggers";
import { enabledPersonas, makeAgentFromPersona, personaToken } from "./catalogApi";

export async function personaSuggestions(query: string) {
  const personas = await enabledPersonas().catch(() => []);
  const items = personas.map((persona) => ({
    key: `persona:${persona.id}`,
    // Matched on the token and the persona's own name together.
    name: personaToken(persona.id),
    label: persona.name,
    description: `${persona.icon ? `${persona.icon} ` : ""}${persona.name} · ${persona.description}`,
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

/** "Make an agent from this", on the focused persona row. */
export function PersonaMakeAgent({ id }: { id: string }) {
  const [state, setState] = useState<"idle" | "working" | "made" | "failed">("idle");
  const make = (event: PointerEvent) => {
    // The row itself picks the persona; this button only makes the agent.
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
      variant="ghost"
      size="xs"
      className="shrink-0 text-2xs text-cream-muted"
      onPointerDown={make}
      disabled={state === "working"}
    >
      {state === "made" ? (
        <span className="inline-flex items-center gap-1">
          <Check aria-hidden className="size-3" />
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
