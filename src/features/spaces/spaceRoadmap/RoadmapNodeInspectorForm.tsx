import { useEffect, useState } from "react";
import { Archive } from "lucide-react";
import type {
  SpaceRoadmapFieldDefinition,
  SpaceRoadmapNode,
  SpaceRoadmapSnapshot,
} from "@/models/interfaces/features/spaces/plannerExpansionTypes";
import {
  Button,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@/ui";
import { builtInRoadmapPalette } from "./roadmapNodeCatalog";
import { useRoadmapAutosave } from "./useRoadmapAutosave";

export function RoadmapNodeForm({
  node,
  snapshot,
  canManage,
  onSave,
  onArchive,
  onDirty,
}: {
  node: SpaceRoadmapNode;
  snapshot: SpaceRoadmapSnapshot;
  canManage: boolean;
  onSave: (value: SpaceRoadmapNode) => void;
  onArchive: () => void;
  onDirty: () => void;
}) {
  const [draft, setDraft] = useState(node);
  useEffect(() => setDraft(node), [node]);
  const autosave = useRoadmapAutosave(draft, onSave, onDirty);
  const definition = snapshot.node_definitions.find((item) => item.id === node.definition_id);
  const builtIn = builtInRoadmapPalette.find((item) => item.kind === node.node_kind);
  const fields = (definition?.field_schema ?? builtIn?.fields ?? []).filter(
    (field) => !field.archived,
  );
  const agendaVisible =
    node.node_kind === "risk" ||
    node.node_kind === "decision" ||
    node.node_kind === "metric" ||
    Boolean(definition?.agenda_visible);
  const update = (patch: Partial<SpaceRoadmapNode>) => {
    autosave.markDirty();
    setDraft((current) => ({ ...current, ...patch }));
  };
  const updateValue = (id: string, value: string | number | boolean) =>
    update({ field_values: { ...draft.field_values, [id]: value } });
  return (
    <div className="grid gap-4">
      <Header
        title={definition?.name ?? builtIn?.label ?? "Planning node"}
        status="Supporting node"
      />
      <Field label="Title">
        <Input
          value={draft.title}
          disabled={!canManage}
          onChange={(event) => update({ title: event.target.value })}
          onBlur={() => draft.title.trim() && autosave.flush()}
        />
      </Field>
      <Field label="Description">
        <Textarea
          value={draft.description}
          disabled={!canManage}
          onChange={(event) => update({ description: event.target.value })}
          onBlur={autosave.flush}
        />
      </Field>
      <Field label="Milestone">
        <Select
          value={draft.milestone_id || "none"}
          disabled={!canManage}
          onValueChange={(value) => {
            const next = { ...draft, milestone_id: value === "none" ? undefined : value };
            setDraft(next);
            onDirty();
            onSave(next);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Free-floating</SelectItem>
            {snapshot.milestones.map((milestone) => (
              <SelectItem key={milestone.id} value={milestone.id}>
                {milestone.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {agendaVisible ? (
        <Field label="Target date">
          <Input
            type="date"
            value={draft.target_date?.slice(0, 10) ?? ""}
            disabled={!canManage}
            onChange={(event) =>
              update({
                target_date: event.target.value ? `${event.target.value}T00:00:00Z` : undefined,
              })
            }
            onBlur={autosave.flush}
          />
        </Field>
      ) : null}
      {fields.map((field) => (
        <NodeValueField
          key={field.id}
          field={field}
          value={draft.field_values[field.id]}
          disabled={!canManage}
          onChange={(value) => updateValue(field.id, value)}
          onBlur={autosave.flush}
        />
      ))}
      {canManage ? (
        <Button variant="ghost" className="justify-start text-destructive" onClick={onArchive}>
          <Archive className="size-4" />
          Archive node
        </Button>
      ) : null}
    </div>
  );
}

function NodeValueField({
  field,
  value,
  disabled,
  onChange,
  onBlur,
}: {
  field: SpaceRoadmapFieldDefinition;
  value: string | number | boolean | undefined;
  disabled: boolean;
  onChange: (value: string | number | boolean) => void;
  onBlur: () => void;
}) {
  if (field.type === "checkbox")
    return (
      <label className="flex items-center gap-2 text-xs font-medium">
        <Checkbox
          checked={value === true}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
        {field.label}
      </label>
    );
  if (field.type === "select")
    return (
      <Field label={field.label}>
        <Select value={String(value ?? "")} disabled={disabled} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem value={option} key={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    );
  if (field.type === "long_text")
    return (
      <Field label={field.label}>
        <Textarea
          value={String(value ?? "")}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
      </Field>
    );
  return (
    <Field label={field.label}>
      <Input
        type={
          field.type === "number"
            ? "number"
            : field.type === "date"
              ? "date"
              : field.type === "url"
                ? "url"
                : "text"
        }
        value={typeof value === "boolean" ? "" : (value ?? "")}
        disabled={disabled}
        onChange={(event) =>
          onChange(field.type === "number" ? Number(event.target.value) : event.target.value)
        }
        onBlur={onBlur}
      />
    </Field>
  );
}

function Header({ title, status }: { title: string; status: string }) {
  return (
    <div>
      <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{status}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      {label}
      {children}
    </label>
  );
}
