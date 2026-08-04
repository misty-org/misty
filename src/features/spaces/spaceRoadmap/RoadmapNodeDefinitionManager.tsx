import { useState } from "react";
import { ArrowDown, ArrowUp, Archive, Plus } from "lucide-react";
import { errorText } from "@/lib/format";
import type {
  SpaceRoadmapFieldDefinition,
  SpaceRoadmapFieldType,
  SpaceRoadmapNodeColor,
  SpaceRoadmapNodeDefinition,
} from "@/models/interfaces/features/spaces/plannerExpansionTypes";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  cn,
} from "@/ui";
import { roadmapIconChoices, roadmapNodeColors } from "./roadmapNodeCatalog";

const fieldTypes: Array<{ value: SpaceRoadmapFieldType; label: string }> = [
  { value: "short_text", label: "Short text" },
  { value: "long_text", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "url", label: "URL" },
  { value: "select", label: "Select" },
  { value: "checkbox", label: "Checkbox" },
];

export function RoadmapNodeDefinitionManager(props: {
  open: boolean;
  definitions: SpaceRoadmapNodeDefinition[];
  onOpenChange: (open: boolean) => void;
  onCreate: (value: Partial<SpaceRoadmapNodeDefinition>) => Promise<void>;
  onUpdate: (value: SpaceRoadmapNodeDefinition) => Promise<void>;
  onArchive: (value: SpaceRoadmapNodeDefinition) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState("");
  const selected = props.definitions.find((item) => item.id === selectedId);
  const [draft, setDraft] = useState(() => emptyDefinition());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const choose = (definition?: SpaceRoadmapNodeDefinition) => {
    setFailure("");
    setSelectedId(definition?.id ?? "");
    setDraft(definition ? structuredClone(definition) : emptyDefinition());
  };
  const save = async () => {
    if (!draft.name?.trim()) return;
    setBusy(true);
    setFailure("");
    try {
      if (selected) await props.onUpdate({ ...selected, ...draft } as SpaceRoadmapNodeDefinition);
      else await props.onCreate(draft);
      choose();
    } catch (reason) {
      setFailure(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const archive = async () => {
    if (!selected) return;
    setBusy(true);
    setFailure("");
    try {
      await props.onArchive(selected);
      choose();
    } catch (reason) {
      setFailure(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[82vh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <DialogTitle>Custom roadmap nodes</DialogTitle>
          <DialogDescription>Create a shared node type for this Space.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 md:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="border-b border-border/60 p-2 md:border-b-0 md:border-r">
            <Button
              variant="ghost"
              className="h-9 w-full justify-start gap-2 text-xs"
              onClick={() => choose()}
            >
              <Plus className="size-3.5" />
              New node type
            </Button>
            {props.definitions
              .filter((item) => !item.archived_at)
              .map((definition) => (
                <Button
                  key={definition.id}
                  variant={selectedId === definition.id ? "secondary" : "ghost"}
                  className="h-9 w-full justify-start truncate text-xs"
                  onClick={() => choose(definition)}
                >
                  {definition.name}
                </Button>
              ))}
          </aside>
          <div className="misty-transient-scrollbar max-h-[62vh] overflow-auto p-5">
            {failure ? (
              <p
                role="alert"
                className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {failure}
              </p>
            ) : null}
            <div className="grid gap-4">
              <Field label="Name">
                <Input
                  value={draft.name ?? ""}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>
              <Field label="Description">
                <Textarea
                  value={draft.description ?? ""}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Icon">
                  <Select value={draft.icon} onValueChange={(icon) => setDraft({ ...draft, icon })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roadmapIconChoices.map((choice) => (
                        <SelectItem value={choice.id} key={choice.id}>
                          {choice.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Color">
                  <Select
                    value={draft.color}
                    onValueChange={(color) =>
                      setDraft({ ...draft, color: color as SpaceRoadmapNodeColor })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.keys(roadmapNodeColors).map((color) => (
                        <SelectItem value={color} key={color}>
                          {color[0].toUpperCase() + color.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <label className="flex items-center justify-between rounded-lg border border-border/60 p-3 text-xs">
                <span>
                  <strong className="block">Show target dates in Agenda</strong>
                  <span className="text-muted-foreground">
                    Instances gain an optional shared target date.
                  </span>
                </span>
                <Switch
                  checked={draft.agenda_visible}
                  onCheckedChange={(agenda_visible) => setDraft({ ...draft, agenda_visible })}
                />
              </label>
              <div>
                <div className="mb-2 flex items-center">
                  <strong className="text-xs">Fields</strong>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 gap-1 text-xs"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        field_schema: [
                          ...(draft.field_schema ?? []),
                          newField(draft.field_schema ?? []),
                        ],
                      })
                    }
                  >
                    <Plus className="size-3" />
                    Field
                  </Button>
                </div>
                <div className="grid gap-2">
                  {(draft.field_schema ?? []).map((field, index) => (
                    <div
                      className="grid grid-cols-[minmax(0,1fr)_140px_auto] gap-2 rounded-lg border border-border/60 p-2"
                      key={field.id}
                    >
                      <Input
                        className="h-8 text-xs"
                        value={field.label}
                        onChange={(event) =>
                          updateField(setDraft, draft, index, { label: event.target.value })
                        }
                      />
                      <Select
                        value={field.type}
                        disabled={Boolean(
                          selected?.field_schema.some((existing) => existing.id === field.id),
                        )}
                        onValueChange={(type) =>
                          updateField(setDraft, draft, index, {
                            type: type as SpaceRoadmapFieldType,
                          })
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {fieldTypes.map((type) => (
                            <SelectItem value={type.value} key={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          disabled={index === 0}
                          aria-label={`Move ${field.label} up`}
                          onClick={() => moveField(setDraft, draft, index, index - 1)}
                        >
                          <ArrowUp className="size-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          disabled={index === (draft.field_schema?.length ?? 0) - 1}
                          aria-label={`Move ${field.label} down`}
                          onClick={() => moveField(setDraft, draft, index, index + 1)}
                        >
                          <ArrowDown className="size-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={field.archived ? "Restore field" : "Archive field"}
                          onClick={() =>
                            updateField(setDraft, draft, index, { archived: !field.archived })
                          }
                        >
                          <Archive
                            className={cn("size-3.5", field.archived && "text-destructive")}
                          />
                        </Button>
                      </div>
                      {field.type === "select" ? (
                        <Input
                          className="col-span-3 h-8 text-xs"
                          placeholder="Options separated by commas"
                          value={(field.options ?? []).join(", ")}
                          onChange={(event) =>
                            updateField(setDraft, draft, index, {
                              options: event.target.value
                                .split(",")
                                .map((value) => value.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="border-t border-border/60 px-5 py-3">
          {selected ? (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto text-destructive"
              disabled={busy}
              onClick={() => void archive()}
            >
              <Archive className="size-4" />
              Archive type
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" disabled={busy || !draft.name?.trim()} onClick={() => void save()}>
            Save node type
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function emptyDefinition(): Partial<SpaceRoadmapNodeDefinition> {
  return {
    name: "",
    description: "",
    icon: "shapes",
    color: "slate",
    agenda_visible: false,
    field_schema: [],
  };
}
function newField(fields: SpaceRoadmapFieldDefinition[]): SpaceRoadmapFieldDefinition {
  let index = fields.length + 1;
  while (fields.some((field) => field.id === `field_${index}`)) index++;
  return { id: `field_${index}`, label: `Field ${index}`, type: "short_text" };
}
function updateField(
  setDraft: React.Dispatch<React.SetStateAction<Partial<SpaceRoadmapNodeDefinition>>>,
  draft: Partial<SpaceRoadmapNodeDefinition>,
  index: number,
  patch: Partial<SpaceRoadmapFieldDefinition>,
) {
  setDraft({
    ...draft,
    field_schema: (draft.field_schema ?? []).map((field, current) =>
      current === index ? { ...field, ...patch } : field,
    ),
  });
}
function moveField(
  setDraft: React.Dispatch<React.SetStateAction<Partial<SpaceRoadmapNodeDefinition>>>,
  draft: Partial<SpaceRoadmapNodeDefinition>,
  from: number,
  to: number,
) {
  const field_schema = [...(draft.field_schema ?? [])];
  if (to < 0 || to >= field_schema.length) return;
  const [field] = field_schema.splice(from, 1);
  if (!field) return;
  field_schema.splice(to, 0, field);
  setDraft({ ...draft, field_schema });
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      {label}
      {children}
    </label>
  );
}
