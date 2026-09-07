import { useEffect, useState, type FormEvent } from "react";
import { personalSpaceTemplatesApi, type SpaceTemplateParts } from "@/api/spaces/templates";
import { useAppStore } from "@/features/app-shell";
import { reportSystemError, systemErrorMessage } from "@/features/support/systemErrors";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Spinner,
  Textarea,
} from "@/shared/ui";

const parts: { id: keyof SpaceTemplateParts; label: string; detail: string }[] = [
  { id: "tasks", label: "Task titles", detail: "Without assignees, dates or notes" },
  { id: "notes", label: "Note outlines", detail: "Titles and headings of notes you wrote" },
  {
    id: "collections",
    label: "Collection names",
    detail: "The Library's collections, without files",
  },
];

/** Space settings → Save as template: captures structure, never content. */
export function SaveSpaceTemplateDialog({
  spaceId,
  spaceName,
  open,
  onOpenChange,
}: {
  spaceId: string;
  spaceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(spaceName);
  const [description, setDescription] = useState("");
  const [include, setInclude] = useState<SpaceTemplateParts>({
    tasks: true,
    notes: true,
    collections: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(spaceName);
    setDescription("");
    setInclude({ tasks: true, notes: true, collections: true });
    setError("");
  }, [open, spaceName]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await personalSpaceTemplatesApi.save({
        name: name.trim(),
        description: description.trim(),
        space_id: spaceId,
        include,
      });
      onOpenChange(false);
      useAppStore
        .getState()
        .setMessage(`Saved "${saved.name}". Find it under Mine when you create a Space.`);
    } catch (reason) {
      setError(systemErrorMessage(reason));
      reportSystemError({
        error: reason,
        scope: "spaces:save-template",
        title: "Template could not be saved",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent aria-describedby="save-template-description" className="max-w-md">
        <form className="grid gap-4" onSubmit={(event) => void save(event)}>
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
            <DialogDescription id="save-template-description">
              Start future Spaces with {spaceName}'s structure. Only you can use this template.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-xs font-medium text-cream-muted">
            Name
            <Input
              autoFocus
              maxLength={80}
              value={name}
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-xs font-medium text-cream-muted">
            Description
            <Textarea
              rows={2}
              maxLength={1000}
              value={description}
              disabled={saving}
              placeholder="What this template is for"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className="grid gap-2.5">
            <p className="m-0 text-xs font-medium text-cream-muted">Includes</p>
            {parts.map((part) => (
              <label key={part.id} className="flex items-start gap-2.5 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={include[part.id]}
                  disabled={saving}
                  onCheckedChange={(checked) =>
                    setInclude((current) => ({ ...current, [part.id]: checked === true }))
                  }
                />
                <span className="grid">
                  <span className="text-cream">{part.label}</span>
                  <span className="text-xs text-cream-muted">{part.detail}</span>
                </span>
              </label>
            ))}
            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox className="mt-0.5" checked={false} disabled />
              <span className="grid">
                <span className="text-cream-muted">Files and messages</span>
                <span className="text-xs text-cream-muted">Never copied</span>
              </span>
            </label>
          </div>
          {error ? (
            <p role="alert" className="m-0 text-sm text-cream">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()} aria-busy={saving}>
              {saving ? <Spinner size="sm" label={false} /> : null}
              Save template
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
