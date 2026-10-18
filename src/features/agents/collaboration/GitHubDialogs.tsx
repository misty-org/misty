import { Lock } from "lucide-react";
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
  Pressable,
  Skeleton,
  Switch,
} from "@/shared/ui";
import {
  cloneProject,
  createGitHubRepo,
  githubRepos,
  publishProject,
  type GitHubRepo,
} from "../store/projectGitHub";
import { failure } from "./ProjectDialogs";

type Created = { id: string; displayName: string };

/** From GitHub: clone one of the person's repositories into a new project. */
export function FromGitHubDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreated(project: Created): void;
}) {
  const [repos, setRepos] = useState<GitHubRepo[]>();
  const [query, setQuery] = useState("");
  const [cloning, setCloning] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!props.open) return;
    setRepos(undefined);
    setError("");
    setQuery("");
    void githubRepos()
      .then(setRepos)
      .catch((problem) => {
        setRepos([]);
        setError(failure(problem, "Your GitHub repositories couldn’t be listed."));
      });
  }, [props.open]);
  const clone = async (repo: GitHubRepo) => {
    const full = `${repo.owner}/${repo.name}`;
    setCloning(full);
    setError("");
    try {
      const created = await cloneProject(repo);
      if (created) props.onCreated(created);
    } catch (problem) {
      setError(failure(problem, `${full} couldn’t be cloned.`));
    } finally {
      setCloning("");
    }
  };
  const shown = (repos ?? []).filter((repo) =>
    `${repo.owner}/${repo.name}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>From GitHub</DialogTitle>
          <DialogDescription>
            Clone a repository from your connected GitHub account into a new project folder. Git on
            this computer does the cloning, signed in the way it usually is.
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Search repositories"
          placeholder="Search repositories"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="max-h-80 overflow-y-auto">
          {repos === undefined ? (
            <div className="grid gap-2" aria-hidden="true">
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <ul className="grid gap-1">
              {shown.map((repo) => {
                const full = `${repo.owner}/${repo.name}`;
                return (
                  <li key={full}>
                    <Pressable
                      disabled={Boolean(cloning)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-charcoal-hover disabled:opacity-60"
                      onClick={() => void clone(repo)}
                    >
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="truncate">{full}</span>
                        {repo.description ? (
                          <span className="truncate text-xs text-cream-muted">
                            {repo.description}
                          </span>
                        ) : null}
                      </span>
                      {repo.private ? <Lock size={13} aria-label="Private" /> : null}
                      {cloning === full ? (
                        <span className="text-xs text-cream-muted">Cloning</span>
                      ) : null}
                    </Pressable>
                  </li>
                );
              })}
              {repos.length && !shown.length ? (
                <li className="px-2 py-2 text-sm text-cream-muted">No repositories match.</li>
              ) : null}
            </ul>
          )}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-cream-muted">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** GitHub accepts letters, numbers, dots, dashes and underscores. */
export function repositoryName(name: string) {
  return name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
}

/** Publish to GitHub: a new repository on the connected account, then a push from this computer. */
export function PublishDialog(props: {
  open: boolean;
  scopeId: string;
  suggestedName: string;
  onOpenChange(open: boolean): void;
  onPublished(remote: string): void;
}) {
  const [name, setName] = useState(repositoryName(props.suggestedName));
  const [isPrivate, setPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** A repository made on an earlier try whose push failed; a retry reuses it. */
  const [made, setMade] = useState<GitHubRepo | null>(null);
  const [done, setDone] = useState("");
  useEffect(() => {
    if (props.open) {
      setName(repositoryName(props.suggestedName));
      setPrivate(true);
      setError("");
      setMade(null);
      setDone("");
    }
  }, [props.open, props.suggestedName]);
  const valid = repositoryName(name) === name && name.length > 0;
  const submit = async () => {
    setBusy(true);
    setError("");
    let repo = made;
    try {
      repo ??= await createGitHubRepo({ name, private: isPrivate });
      setMade(repo);
      await publishProject(props.scopeId, repo.cloneUrl);
      setDone(`${repo.owner}/${repo.name}`);
      props.onPublished(`${repo.owner}/${repo.name}`);
    } catch (problem) {
      const reason = failure(problem, "Publishing didn’t work.");
      setError(
        repo ? `${reason} Publish again to retry the push to ${repo.owner}/${repo.name}.` : reason,
      );
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
            Makes a repository on your connected GitHub account and pushes this project to it with
            git on this computer. A folder without commits gets one with everything in it.
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <>
            <p role="status" className="text-sm">
              Published to {done}. Your coding tool pushes there from now on, asking first.
            </p>
            <DialogFooter>
              <Button onClick={() => props.onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="grid gap-3">
              <label className="grid gap-1 text-sm">
                Repository name
                <Input
                  value={name}
                  disabled={Boolean(made)}
                  onChange={(event) => setName(event.target.value)}
                />
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
                  disabled={Boolean(made)}
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
