import { ArrowDown, ArrowUp, ExternalLink, GitBranch, GitCommitHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, SegmentedControl, Skeleton, Textarea, Pressable } from "@/shared/ui";
import { pull, push, type ProjectGitStatus } from "../../git/gitSync";
import { commitAuthor, projectGit } from "../../git/projectGit";
import { DiffView } from "./DiffView";
import type { DiffSet } from "./diffTypes";
import { PublishDialog } from "./PublishDialog";

interface Commit {
  sha: string;
  subject: string;
  author: string;
  date: string;
  onGitHub: boolean;
}

const time = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function failure(error: unknown) {
  return error instanceof Error ? error.message : "That didn’t work.";
}

/**
 * One project's Git, the way Claude Code and Codex review work: uncommitted
 * changes as a diff with a commit box, history with each commit's diff, and
 * Push, Pull or Publish to GitHub (docs/plans/agent-git-projects.md).
 */
export function ProjectReview({ scopeId, name }: { scopeId: string; name: string }) {
  const git = useMemo(() => projectGit(scopeId), [scopeId]);
  const [status, setStatus] = useState<ProjectGitStatus>();
  const [tab, setTab] = useState<"changes" | "history">("changes");
  const [diff, setDiff] = useState<DiffSet>();
  const [commits, setCommits] = useState<Commit[]>();
  const [selected, setSelected] = useState<string>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [publishing, setPublishing] = useState(false);

  const load = useCallback(async () => {
    const next = await git.native<ProjectGitStatus>("status");
    setStatus(next);
    if (!next.repository) return;
    setDiff(await git.native<DiffSet>("diff", {}));
    setCommits((await git.native<{ commits: Commit[] }>("log", { limit: 50 })).commits);
  }, [git]);

  useEffect(() => {
    void load().catch((error) => setNotice(failure(error)));
  }, [load]);

  useEffect(() => {
    if (tab !== "history" || !selected) return;
    setDiff(undefined);
    void git
      .native<DiffSet>("diff", { commit: selected })
      .then(setDiff)
      .catch((error) => setNotice(failure(error)));
  }, [git, tab, selected]);

  const run = async (label: string, action: () => Promise<string | void>) => {
    setBusy(label);
    setNotice("");
    try {
      const done = await action();
      await load();
      if (done) setNotice(done);
    } catch (error) {
      setNotice(failure(error));
    } finally {
      setBusy("");
    }
  };

  if (!status)
    return (
      <div className="grid gap-3 p-6" aria-hidden="true">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );

  if (!status.repository)
    return (
      <div className="grid gap-3 p-6">
        <h2 className="text-base font-medium">{name}</h2>
        <p className="text-sm text-cream-muted">
          This project isn’t a Git repository yet. Turn on Git to commit changes, see history and
          put the project on GitHub.
        </p>
        <Button
          className="justify-self-start"
          disabled={Boolean(busy)}
          onClick={() => void run("init", async () => void (await git.native("init")))}
        >
          Turn on Git
        </Button>
        {notice ? <p className="text-sm text-cream-muted">{notice}</p> : null}
      </div>
    );

  const github = status.github;
  const commit = async () => {
    const result = await git.native<{ refused?: { path: string }[] }>("commit", {
      message,
      author: await commitAuthor(),
    });
    setMessage("");
    const left = result.refused?.map((item) => item.path) ?? [];
    return left.length
      ? `Committed. Left out ${left.join(", ")}: Misty never commits secret or very large files.`
      : "Committed.";
  };
  const showing = tab === "changes" ? diff : selected ? diff : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-charcoal-border px-5 py-3">
        <h2 className="mr-auto min-w-0 truncate text-base font-medium">{name}</h2>
        <span className="flex items-center gap-1 text-xs text-cream-muted">
          <GitBranch size={13} aria-hidden="true" />
          {status.branch}
        </span>
        {github ? (
          <>
            <a
              className="flex items-center gap-1 text-xs text-cream-muted hover:text-cream"
              href={`https://github.com/${github.owner}/${github.name}`}
              target="_blank"
              rel="noreferrer"
            >
              {github.owner}/{github.name}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
            <Button
              variant="outline"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() =>
                void run("pull", async () => {
                  const result = await pull(git);
                  return {
                    updated: "Pulled the latest from GitHub.",
                    up_to_date: "Already up to date.",
                    ahead: "Nothing new on GitHub.",
                    diverged:
                      "GitHub and this project have both changed. Merge them in your own Git tool.",
                    blocked: "Commit or undo your changes first, then pull.",
                    not_on_github: `${result.branch} isn’t on GitHub yet.`,
                  }[result.state];
                })
              }
            >
              <ArrowDown size={14} aria-hidden="true" />
              Pull{status.behind ? ` ${status.behind}` : ""}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={Boolean(busy) || (status.published && !status.ahead)}
              onClick={() =>
                void run("push", async () => {
                  const result = await push(git);
                  return result.upToDate
                    ? "Already on GitHub."
                    : `Pushed ${result.commits} ${result.commits === 1 ? "commit" : "commits"} to ${result.branch}.`;
                })
              }
            >
              <ArrowUp size={14} aria-hidden="true" />
              Push{status.ahead ? ` ${status.ahead}` : ""}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={Boolean(busy) || !status.head}
            onClick={() => setPublishing(true)}
          >
            Publish to GitHub
          </Button>
        )}
      </header>
      <div className="flex items-center gap-3 px-5 py-2">
        <SegmentedControl
          label="Review"
          value={tab}
          options={[
            {
              value: "changes",
              label: `Changes${status.files?.length ? ` ${status.files.length}` : ""}`,
            },
            { value: "history", label: "History" },
          ]}
          onChange={(next) => {
            setTab(next);
            setSelected(undefined);
            if (next === "changes") void load();
          }}
        />
        {notice ? (
          <p role="status" className="min-w-0 truncate text-xs text-cream-muted">
            {notice}
          </p>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1">
        {tab === "history" ? (
          <ol
            className="w-72 shrink-0 overflow-y-auto border-r border-charcoal-border"
            aria-label="Commits"
          >
            {commits?.map((item) => (
              <li key={item.sha}>
                <Pressable
                  className="grid w-full gap-0.5 px-4 py-2 text-left text-sm hover:bg-charcoal-hover aria-[current=true]:bg-charcoal-hover"
                  aria-current={selected === item.sha}
                  onClick={() => setSelected(item.sha)}
                >
                  <span className="truncate">{item.subject}</span>
                  <span className="truncate text-xs text-cream-muted">
                    {item.sha.slice(0, 7)} · {item.author} · {time.format(new Date(item.date))}
                    {item.onGitHub ? " · on GitHub" : ""}
                  </span>
                </Pressable>
              </li>
            ))}
            {commits && !commits.length ? (
              <li className="px-4 py-3 text-sm text-cream-muted">No commits yet.</li>
            ) : null}
          </ol>
        ) : null}
        <div className="min-w-0 flex-1 overflow-y-auto px-5 py-3">
          {showing ? (
            <DiffView set={showing} />
          ) : tab === "history" ? (
            <p className="text-sm text-cream-muted">Pick a commit to see what it changed.</p>
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </div>
      </div>
      {tab === "changes" ? (
        <footer className="flex items-end gap-2 border-t border-charcoal-border px-5 py-3">
          <Textarea
            aria-label="Commit message"
            placeholder="What changed and why"
            rows={2}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className="min-h-0 flex-1"
          />
          <Button
            disabled={Boolean(busy) || status.clean || !message.trim()}
            onClick={() => void run("commit", commit)}
          >
            <GitCommitHorizontal size={14} aria-hidden="true" />
            Commit
          </Button>
        </footer>
      ) : null}
      <PublishDialog
        open={publishing}
        suggestedName={name}
        onOpenChange={setPublishing}
        transport={git}
        onPublished={(text) => {
          setPublishing(false);
          setNotice(text);
          void load();
        }}
      />
    </div>
  );
}
