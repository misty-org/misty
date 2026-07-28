import type { ComponentType } from "react";
import { CalendarDays, Check, FileText } from "lucide-react";
import { SiDiscord } from "react-icons/si";
import { Input } from "@/ui";
import type {
  ProviderConnectionAvailability,
  SpaceIntegrationProvider,
  SpaceTemplate,
} from "@/models/interfaces/features/spaces/types";

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
  { id: "google", name: "Google Calendar", icon: CalendarDays },
  { id: "discord", name: "Discord", icon: SiDiscord },
  { id: "notion", name: "Notion", icon: FileText },
];

const cardClass = (selected: boolean) =>
  `rounded-lg border p-3 text-left transition-colors ${
    selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/55"
  }`;

export function CreateSpaceNameStep({
  name,
  onName,
}: {
  name: string;
  onName: (value: string) => void;
}) {
  return (
    <label className="mt-5 grid gap-2 text-xs font-medium text-muted-foreground">
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
      <p className="mb-3 mt-1 text-xs text-muted-foreground">
        Optional starter content—nothing is locked in.
      </p>
      <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1">
        {(templates.length ? templates : blankTemplateFallback).map((template) => (
          <button
            key={template.id}
            className={cardClass(templateId === template.id)}
            type="button"
            onClick={() => onTemplate(template.id)}
          >
            <span className="block text-sm font-medium">{template.name}</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {template.description}
            </span>
          </button>
        ))}
      </div>
      {templateError ? (
        <p className="mb-0 mt-2 text-xs text-muted-foreground">{templateError}</p>
      ) : null}
    </section>
  );
}

export function CreateSpaceIntegrationsStep({
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
      <p className="mb-3 mt-1 text-xs text-muted-foreground">
        Optional. Setup can be closed and resumed at any time.
      </p>
      <div className="grid gap-2">
        {integrationChoices.map(({ id, name, icon: Icon }) => {
          const selected = providers.includes(id);
          const unavailable =
            availability.find((provider) => provider.provider === id)?.configured === false;
          return (
            <button
              key={id}
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
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    Unavailable
                  </span>
                ) : null}
              </span>
              <span
                className={`grid size-5 place-items-center rounded-full border ${
                  selected ? "border-primary bg-primary text-primary-foreground" : ""
                }`}
              >
                {selected ? <Check size={12} /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
