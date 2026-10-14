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
  Skeleton,
  Pressable,
} from "@/shared/ui";
import { cloneInto } from "../git/gitSync";
import { githubRepos, projectGit } from "../git/projectGit";
import { codeCloneProject, codeNewProject, codeRemoveProject } from "../store/useAgentsStore";

type Created = { id: string; displayName: string };

function failure(error: unknown, fallback: string) {
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
      const created = await codeNewProject(name);
      if (created) props.onCreated(created);
    } catch (problem) {
      setError(failure(problem, "That project couldn’t be created."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            A new folder on this computer, set up with Git. It stays local until you publish it to
            GitHub.
          </DialogDescription>
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
          {error ? (
            <p role="alert" className="text-sm text-cream-muted">
              {error}
            </p>
          ) : null}
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

type Repo = Awaited<ReturnType<typeof githubRepos>>[number];

/** From GitHub: one of the connected account's repositories, cloned into a new project. */
export function FromGitHubDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreated(project: Created): void;
}) {
  const [repos, setRepos] = useState<Repo[]>();
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
  const clone = async (repo: Repo) => {
    const full = `${repo.owner}/${repo.name}`;
    setCloning(full);
    setError("");
    let created: Created | null = null;
    try {
      created = await codeCloneProject(repo.owner, repo.name, repo.defaultBranch);
      if (!created) return;
      await cloneInto(projectGit(created.id), repo, repo.defaultBranch);
      props.onCreated(created);
    } catch (problem) {
      if (created) await codeRemoveProject(created.id).catch(() => undefined);
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
            Clone a repository from your connected GitHub account into a new project. Recent history
            comes along.
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
