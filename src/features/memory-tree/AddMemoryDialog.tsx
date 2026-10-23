import { useState } from "react";
import { ApiRequestError } from "@/api/client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  SegmentedControl,
  Textarea,
} from "@/shared/ui";
import { addForms, FACT_KINDS } from "./addForms";
import { type MemoryBranch } from "./model";
import { useMemoryTreeStore } from "./useMemoryTreeStore";

/** Writes a memory into one branch by hand. Which fields show depends on the branch. */
export function AddMemoryDialog({ branch }: { branch: MemoryBranch }) {
  const form = addForms[branch];
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [text, setText] = useState("");
  const [kind, setKind] = useState<string>("fact");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => useMemoryTreeStore.getState().askAdd(null);

  const save = async () => {
    if (!text.trim())
      return setError(`Write the ${form.textLabel.toLowerCase().replace("?", "")} first.`);
    if (form.titleRequired && !title.trim()) return setError("Give it a name first.");
    setBusy(true);
    setError("");
    try {
      await useMemoryTreeStore.getState().add({
        branch,
        title,
        description,
        text,
        kind: form.kinds ? kind : undefined,
      });
      close();
    } catch (failure) {
      setError(
        failure instanceof ApiRequestError && failure.message
          ? failure.message
          : "Memory couldn't keep that. Try again.",
      );
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{form.menu}</DialogTitle>
          <DialogDescription>{form.help}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {form.kinds && (
            <SegmentedControl
              label="Kind of memory"
              value={kind}
              options={FACT_KINDS}
              onChange={setKind}
            />
          )}
          {form.titleLabel && (
            <Field label={form.titleLabel}>
              <Input
                value={title}
                maxLength={form.titleRequired ? 120 : 300}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
          )}
          {form.descriptionLabel && (
            <Field label={form.descriptionLabel}>
              <Input
                value={description}
                maxLength={1000}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
          )}
          <Field label={form.textLabel} error={error || undefined}>
            <Textarea
              value={text}
              rows={form.textMax > 2000 ? 7 : 4}
              maxLength={form.textMax}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
