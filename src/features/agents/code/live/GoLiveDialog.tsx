import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
  Text,
} from "@misty/ui";
import { gitApi, gitErrorText } from "../../context-panel/git/gitApi";
import { liveApi, liveErrorText } from "./liveApi";
import { goLive } from "./liveSession";
import type { LiveRepo } from "./liveTypes";

/**
 * Going live on the Space folder's repository: a name, then a session that branches from the
 * folder's HEAD. Others fetch that commit from origin, so it has to be there; if it isn't, the
 * person can push their branch first, with the same push as the Git panel.
 */
export function GoLiveDialog(props: {
  open: boolean;
  onClose(): void;
  folder: string;
  spaceId: string;
  spaceKey: string;
}) {
  const { open, folder } = props;
  const [name, setName] = useState("");
  const [repo, setRepo] = useState<LiveRepo | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const check = (live: () => boolean) => {
    setChecking(true);
    setError("");
    liveApi
      .repo(folder, null, true)
      .then((found) => {
        if (!live()) return;
        setRepo(found);
        setName((current) => current || (found.branch ?? ""));
      })
      .catch((reason) => live() && setError(liveErrorText(reason)))
      .finally(() => live() && setChecking(false));
  };

  useEffect(() => {
    if (!open) return;
    let live = true;
    setRepo(null);
    setName("");
    check(() => live);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads again each time it opens
  }, [open, folder]);

  const push = () => {
    setBusy(true);
    setError("");
    gitApi
      .push(folder)
      .then(() => check(() => true))
      .catch((reason) => setError(gitErrorText(reason)))
      .finally(() => setBusy(false));
  };

  const start = () => {
    if (!repo || !name.trim()) return;
    setBusy(true);
    setError("");
    goLive({
      spaceId: props.spaceId,
      spaceKey: props.spaceKey,
      spaceFolder: folder,
      name: name.trim(),
      repo,
    })
      .then(props.onClose)
      .catch((reason) => setError(liveErrorText(reason)))
      .finally(() => setBusy(false));
  };

  const unpushed = repo && !repo.baseOnRemote;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && props.onClose()}>
      <DialogContent
        className="max-w-sm"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            start();
          }}
        >
          <DialogHeader>
            <DialogTitle>Go live</DialogTitle>
          </DialogHeader>
          <Input
            ref={inputRef}
            aria-label="Name"
            placeholder="Session name"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />
          {checking ? (
            <Skeleton className="h-3 w-48 rounded-sm" />
          ) : unpushed ? (
            <div className="grid gap-2">
              <Text size="meta" tone="danger" wrap>
                {repo.branch
                  ? `${repo.branch} has commits that aren't on origin yet, so nobody else could fetch them.`
                  : "This checkout is on a commit that isn't on origin. Put it on a branch and push it first."}
              </Text>
              {repo.branch ? (
                <div>
                  <Button type="button" disabled={busy} onClick={push}>
                    {`Push ${repo.branch}`}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          <Text size="meta" tone="muted" wrap>
            The session's code is readable on the Space's server, like notes.
          </Text>
          {error ? (
            <Text size="meta" tone="danger" wrap>
              {error}
            </Text>
          ) : null}
          <DialogFooter>
            <Button type="button" size="lg" variant="quiet" onClick={props.onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="lg"
              variant="primary"
              disabled={busy || checking || !repo || Boolean(unpushed) || !name.trim()}
            >
              Go live
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
