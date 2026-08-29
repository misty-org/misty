import type { SpaceTemplate } from "@/api/spaces/dto/interfaces/types";
import { Button, Input } from "@/shared/ui";

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
  onTemplate,
}: {
  templates: SpaceTemplate[];
  templateId: string;
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
    </section>
  );
}
