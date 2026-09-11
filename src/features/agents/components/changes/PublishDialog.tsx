import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Switch,
} from "@/shared/ui";
import { publish, type GitTransport } from "../../git/gitSync";

/** GitHub accepts letters, numbers, dots, dashes and underscores. */
function repositoryName(name: string) {
  return name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
}

/** Publish to GitHub: a new repository on the connected account, then a push. */
export function PublishDialog(props: {
  open: boolean;
  suggestedName: string;
  transport: GitTransport;
  onOpenChange(open: boolean): void;
  onPublished(message: string): void;
}) {
  const [name, setName] = useState(repositoryName(props.suggestedName));
  const [isPrivate, setPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (props.open) {
      setName(repositoryName(props.suggestedName));
      setError("");
    }
  }, [props.open, props.suggestedName]);
  const valid = repositoryName(name) === name && name.length > 0;
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await publish(props.transport, { name, private: isPrivate });
      props.onPublished(`Published to ${result.repo.owner}/${result.repo.name}.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Publishing didn’t work.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Publish to GitHub</DialogTitle>
          <DialogDescription>
            Creates a repository on your connected GitHub account and pushes this project’s commits
            to it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm">
            Repository name
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          {!valid && name ? (
            <p className="text-xs text-cream-muted">
              Use letters, numbers, dots, dashes or underscores.
            </p>
          ) : null}
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="grid gap-0.5">
              Private
              <span className="text-xs text-cream-muted">
                Only you and people you invite can see it.
              </span>
            </span>
            <Switch
              checked={isPrivate}
              onCheckedChange={setPrivate}
              aria-label="Private repository"
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-cream-muted">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !valid} onClick={() => void submit()}>
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
