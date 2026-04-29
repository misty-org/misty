import type {
  ProviderConnectionAvailability,
  SpaceIntegrationProvider,
  SpaceTemplate,
} from "@/services/spaces/dto/interfaces/types";
import { Button, Input } from "@/shared/ui";
import { Check } from "lucide-react";
import type { ComponentType } from "react";
import { SiDiscord, SiGooglecalendar, SiNotion } from "react-icons/si";

export const blankTemplateFallback: SpaceTemplate[] = [
  {
    id: "blank",
    name: "Blank Space",
    description: "Start with a clean Space.",
    version: 1,
    recommended_integrations: [],
    seed_summary: { task_count: 0, note_count: 0, collection_count: 0 },
  },
];

const integrationChoices: Array<{
  id: SpaceIntegrationProvider;
  name: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: "google", name: "Google Calendar", icon: SiGooglecalendar },
  { id: "discord", name: "Discord", icon: SiDiscord },
  { id: "notion", name: "Notion", icon: SiNotion },
];

const cardClass = (selected: boolean) =>
  `h-auto justify-start whitespace-normal rounded-lg border p-3 text-left transition-colors ${
    selected
      ? "border-charcoal-active bg-charcoal-active"
      : "border-charcoal-border hover:bg-charcoal-card"
  }`;

export function CreateSpaceNameStep({
  name,
  onName,
}: {
  name: string;
  onName: (value: string) => void;
}) {
  return (
    <label className="mt-5 grid gap-2 text-xs font-medium text-cream-muted">
      Space name
      <Input
        autoFocus
        maxLength={80}
        placeholder="Design team"
        value={name}
        onChange={(event) => onName(event.target.value)}
      />
    </label>
  );
}

export function CreateSpaceTemplateStep({
  templates,
  templateId,
  templateError,
  onTemplate,
}: {
  templates: SpaceTemplate[];
  templateId: string;
  templateError: string;
  onTemplate: (id: string) => void;
}) {
  return (
    <section className="mt-5">
      <p className="m-0 text-sm font-medium">Choose a template</p>
      <p className="mb-3 mt-1 text-xs text-cream-muted">
        Optional starter content—nothing is locked in.
      </p>
      <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1">
        {(templates.length ? templates : blankTemplateFallback).map((template) => (
          <Button
            key={template.id}
            variant="outline"
            className={cardClass(templateId === template.id)}
            type="button"
            onClick={() => onTemplate(template.id)}
          >
            <span className="block text-sm font-medium">{template.name}</span>
            <span className="mt-1 block text-xs leading-relaxed text-cream-muted">
              {template.description}
            </span>
          </Button>
        ))}
      </div>
      {templateError ? <p className="mb-0 mt-2 text-xs text-cream-muted">{templateError}</p> : null}
    </section>
  );
}

export function CreateSpaceConnectionsStep({
  providers,
  availability,
  onToggle,
}: {
  providers: SpaceIntegrationProvider[];
  availability: ProviderConnectionAvailability[];
  onToggle: (provider: SpaceIntegrationProvider) => void;
}) {
  return (
    <section className="mt-5">
      <p className="m-0 text-sm font-medium">Connect tools your team already uses</p>
      <p className="mb-3 mt-1 text-xs text-cream-muted">
        Optional. Setup can be closed and resumed at any time.
      </p>
      <div className="grid gap-2">
        {integrationChoices.map(({ id, name, icon: Icon }) => {
          const selected = providers.includes(id);
          const unavailable =
            availability.find((provider) => provider.provider === id)?.configured === false;
          return (
            <Button
              key={id}
              variant="outline"
              className={`flex items-center gap-3 ${cardClass(selected)}`}
              type="button"
              aria-pressed={selected}
              disabled={unavailable}
              onClick={() => onToggle(id)}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="flex-1 text-sm font-medium">
                {name}
                {unavailable ? (
                  <span className="ml-2 text-xs font-normal text-cream-muted">Unavailable</span>
                ) : null}
              </span>
              <span
                className={`grid size-5 place-items-center rounded-full border ${
                  selected ? "border-charcoal-active bg-charcoal-active text-cream-bright" : ""
                }`}
              >
                {selected ? <Check size={12} /> : null}
              </span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}
