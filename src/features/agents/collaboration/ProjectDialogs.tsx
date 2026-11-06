import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorNotification,
  Input,
} from "@/shared/ui";
import { newProject } from "../store/useAgentsStore";

type Created = { id: string; displayName: string };

export function failure(error: unknown, fallback: string) {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return text && !text.includes("_") ? text : fallback;
}

/** New project: a name, then where it goes (the system folder picker). Local, with Git. */
export function NewProjectDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreated(project: Created): void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (props.open) {
      setName("");
      setError("");
    }
  }, [props.open]);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const created = await newProject(name);
      if (created) props.onCreated(created);
    } catch (problem) {
      setError(failure(problem, "That project couldn’t be created."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-md">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) void submit();
          }}
        >
          <label className="grid gap-1 text-sm">
            Name
            <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <ErrorNotification message={error} onDismiss={() => setError("")} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              Choose where to create it
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
