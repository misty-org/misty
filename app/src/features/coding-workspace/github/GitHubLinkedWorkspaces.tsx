import {
  githubCodeApi,
  type GitHubCodeWorkspace,
  type GitHubRepositoryRecord,
} from "@/api/integrations/github";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Input,
  Textarea,
} from "@/shared/ui";
import {
  Code2,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  LoaderCircle,
  RefreshCcw,
  Upload,
} from "lucide-react";
import { useState } from "react";
import {
  codeGitClone,
  codeGitCommit,
  codeGitCreateBranch,
  codeGitFetch,
  codeGitPush,
  codeGitWorkspaceId,
} from "../native";
import { useGitStore } from "../git/useGitStore";
import { useGitHubCodeStore } from "./useGitHubCodeStore";

export function GitHubLinkedWorkspaces(props: {
  spaceId: string;
  canManage: boolean;
  rootPath: string | null;
  localWorkspaceId: string;
  onOpenRoot: (root: string) => void;
  resolveRedeemUrl: (path: string) => Promise<string>;
}) {
  const state = useGitHubCodeStore();
  return (
    <section
      className="rounded-xl border border-charcoal-border bg-charcoal-card"
      aria-label="Linked repositories"
    >
      <header className="border-b border-charcoal-border px-4 py-3">
        <h3 className="text-sm font-medium text-cream-bright">Linked repositories</h3>
        <p className="mt-0.5 text-xs text-cream-muted">
          GitHub metadata stays in the Space. Source code stays in your local folder.
        </p>
      </header>
      {!state.workspaces.length ? (
        <p className="m-0 p-4 text-sm text-cream-muted">
          Choose a repository above to link it to Code.
        </p>
      ) : (
        <div className="divide-y divide-charcoal-border">
          {state.workspaces.map((workspace) => (
            <LinkedWorkspace key={workspace.id} {...props} workspace={workspace} />
          ))}
        </div>
      )}
    </section>
  );
}

function LinkedWorkspace(props: {
  spaceId: string;
  canManage: boolean;
  rootPath: string | null;
  localWorkspaceId: string;
  onOpenRoot: (root: string) => void;
  resolveRedeemUrl: (path: string) => Promise<string>;
  workspace: GitHubCodeWorkspace;
}) {
  const store = useGitHubCodeStore();
  const refreshGit = useGitStore((state) => state.refresh);
  const gitSnapshot = useGitStore((state) =>
    props.rootPath ? (state.snapshots[props.rootPath] ?? state.snapshot) : null,
  );
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [branchName, setBranchName] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [confirm, setConfirm] = useState<"push" | "pr" | "unlink" | "">("");
  const linkedHere = Boolean(
    props.rootPath &&
    props.localWorkspaceId &&
    props.workspace.client_workspace_id === props.localWorkspaceId,
  );
  const canPush = Boolean(
    props.canManage &&
    (props.workspace.permissions.push ||
      props.workspace.permissions.admin ||
      props.workspace.permissions.maintain),
  );
  const records = store.recordsByWorkspace[props.workspace.id];

  const remote = async (operation: "fetch" | "push" | "clone", destination = "") => {
    setBusy(operation);
    setError("");
    setMessage("");
    try {
      const handoff = await githubCodeApi.createHandoff(props.spaceId, props.workspace.id);
      const redeemUrl = await props.resolveRedeemUrl(handoff.redeem_path);
      if (operation === "clone") {
        await codeGitClone(destination, redeemUrl, handoff.handoff);
        const localId = await codeGitWorkspaceId(destination);
        await store.bind(
          props.spaceId,
          props.workspace.installation_id,
          props.workspace.repository_id,
          localId,
        );
        props.onOpenRoot(destination);
        setMessage("Repository cloned and opened.");
      } else if (props.rootPath) {
        if (operation === "fetch") await codeGitFetch(props.rootPath, redeemUrl, handoff.handoff);
        else await codeGitPush(props.rootPath, redeemUrl, handoff.handoff);
        await refreshGit(props.rootPath);
        setMessage(operation === "fetch" ? "Fetched from GitHub." : "Branch pushed to GitHub.");
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `Git ${operation} failed.`);
    } finally {
      setBusy("");
    }
  };

  const clone = async () => {
    const parent = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose clone location",
    });
    if (typeof parent !== "string") return;
    const repositoryName = props.workspace.full_name.split("/").pop() || "repository";
    await remote("clone", await join(parent, repositoryName));
  };

  const createBranch = async () => {
    if (!props.rootPath || !branchName.trim()) return;
    setBusy("branch");
    setError("");
    try {
      await codeGitCreateBranch(props.rootPath, branchName.trim());
      await refreshGit(props.rootPath);
      setBranchName("");
      setMessage("Local branch created. It has not been pushed.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Branch could not be created.");
    } finally {
      setBusy("");
    }
  };

  const commit = async () => {
    if (!props.rootPath || !commitMessage.trim()) return;
    setBusy("commit");
    setError("");
    try {
      await codeGitCommit(props.rootPath, commitMessage, true);
      await refreshGit(props.rootPath);
      setCommitMessage("");
      setMessage("Changes committed locally. Nothing was pushed.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Commit failed.");
    } finally {
      setBusy("");
    }
  };

  const createPullRequest = async () => {
    const head = gitSnapshot?.branch;
    if (!head || !prTitle.trim()) return;
    setBusy("pr");
    setError("");
    try {
      await githubCodeApi.mutate(props.spaceId, props.workspace.id, {
        operation: "create_pull_request",
        confirmed: true,
        payload: {
          title: prTitle.trim(),
          body: prBody.trim(),
          head,
          base: props.workspace.default_branch,
        },
      });
      setPrTitle("");
      setPrBody("");
      setMessage("Pull request created on GitHub.");
      await store.sync(props.spaceId, props.workspace.id);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Pull request could not be created.",
      );
    } finally {
      setBusy("");
    }
  };

  return (
    <article className="grid gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-sm font-medium text-cream-bright hover:underline"
          onClick={() => void openExternalLink(props.workspace.html_url)}
        >
          {props.workspace.full_name} <ExternalLink className="inline size-3" />
        </button>
        <Badge variant={props.workspace.status === "active" ? "secondary" : "outline"}>
          {props.workspace.status === "active" ? "Synced" : "Needs attention"}
        </Badge>
        {linkedHere ? <Badge variant="outline">Open here</Badge> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {props.canManage ? (
          <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void clone()}>
            <Code2 className="size-4" /> Clone
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={Boolean(busy)}
          onClick={() => void store.sync(props.spaceId, props.workspace.id)}
        >
          <RefreshCcw className="size-4" /> Sync provenance
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void store.loadRecords(props.spaceId, props.workspace.id)}
        >
          Activity
        </Button>
        {props.canManage ? (
          <Button size="sm" variant="ghost" onClick={() => setConfirm("unlink")}>
            Unlink
          </Button>
        ) : null}
      </div>

      {linkedHere ? (
        <div className="grid gap-3 rounded-lg border border-charcoal-border bg-charcoal-bg/40 p-3">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!props.canManage || Boolean(busy)}
              onClick={() => void remote("fetch")}
            >
              {busy === "fetch" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <RefreshCcw className="size-4" />
              )}
              Fetch
            </Button>
            <Button
              size="sm"
              disabled={!canPush || Boolean(busy)}
              onClick={() => setConfirm("push")}
            >
              <Upload className="size-4" /> Push…
            </Button>
            {!props.canManage ? (
              <span className="self-center text-xs text-cream-muted">
                Remote actions require Space manager permission
              </span>
            ) : !canPush ? (
              <span className="self-center text-xs text-cream-muted">Read-only GitHub access</span>
            ) : null}
          </div>
          <ActionRow
            icon={<GitBranch className="size-4" />}
            value={branchName}
            placeholder="new-branch"
            action="Create local branch"
            disabled={Boolean(busy)}
            onChange={setBranchName}
            onAction={createBranch}
          />
          <ActionRow
            icon={<GitCommitHorizontal className="size-4" />}
            value={commitMessage}
            placeholder="Commit message"
            action="Commit all locally"
            disabled={Boolean(busy)}
            onChange={setCommitMessage}
            onAction={commit}
          />
          {canPush ? (
            <div className="grid gap-2 border-t border-charcoal-border pt-3">
              <div className="flex items-center gap-2 text-xs font-medium text-cream">
                <GitPullRequest className="size-4" /> Pull request from{" "}
                {gitSnapshot?.branch ?? "current branch"} to {props.workspace.default_branch}
              </div>
              <Input
                value={prTitle}
                onChange={(event) => setPrTitle(event.target.value)}
                placeholder="Pull request title"
              />
              <Textarea
                value={prBody}
                onChange={(event) => setPrBody(event.target.value)}
                placeholder="Description (optional)"
                rows={3}
              />
              <Button
                size="sm"
                className="justify-self-start"
                disabled={!prTitle.trim() || !gitSnapshot?.branch || Boolean(busy)}
                onClick={() => setConfirm("pr")}
              >
                Create pull request…
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="m-0 text-xs text-cream-muted">
          {props.rootPath
            ? "This repository is not linked to the folder currently open in Code."
            : "Clone this repository or open its existing local folder."}
        </p>
      )}

      {message ? (
        <p className="m-0 text-xs text-[#91b89f]" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="m-0 text-xs text-[#d68b80]" role="alert">
          {error}
        </p>
      ) : null}
      {records ? <Provenance records={records} /> : null}

      <Confirmation
        kind={confirm}
        workspace={props.workspace}
        branch={gitSnapshot?.branch ?? "current branch"}
        onCancel={() => setConfirm("")}
        onConfirm={() => {
          const action = confirm;
          setConfirm("");
          if (action === "push") void remote("push");
          else if (action === "pr") void createPullRequest();
          else if (action === "unlink") void store.unlink(props.spaceId, props.workspace.id);
        }}
      />
    </article>
  );
}

function ActionRow(props: {
  icon: React.ReactNode;
  value: string;
  placeholder: string;
  action: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onAction: () => Promise<void>;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-cream-muted">{props.icon}</span>
      <Input
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={props.disabled || !props.value.trim()}
        onClick={() => void props.onAction()}
      >
        {props.action}
      </Button>
    </div>
  );
}

function Provenance({ records }: { records: GitHubRepositoryRecord[] }) {
  return (
    <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-charcoal-border p-2">
      {!records.length ? (
        <p className="m-0 p-2 text-xs text-cream-muted">No GitHub activity yet.</p>
      ) : (
        records.map((record) => (
          <button
            key={record.id}
            type="button"
            disabled={!record.url}
            onClick={() => record.url && void openExternalLink(record.url)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-charcoal-hover disabled:cursor-default"
          >
            <Badge variant="outline">{record.record_type.replace("pull_request", "PR")}</Badge>
            <span className="min-w-0 flex-1 truncate text-xs text-cream">
              {record.title || record.ref_name || record.sha?.slice(0, 8) || record.external_id}
            </span>
            {record.actor_login ? (
              <span className="text-[11px] text-cream-muted">@{record.actor_login}</span>
            ) : null}
          </button>
        ))
      )}
    </div>
  );
}

function Confirmation(props: {
  kind: "push" | "pr" | "unlink" | "";
  workspace: GitHubCodeWorkspace;
  branch: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const remote = props.kind === "push" || props.kind === "pr";
  return (
    <AlertDialog open={Boolean(props.kind)} onOpenChange={(open) => !open && props.onCancel()}>
      <AlertDialogContent className="code-theme-overlay">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {props.kind === "push"
              ? `Push ${props.branch}?`
              : props.kind === "pr"
                ? "Create this pull request?"
                : "Unlink this repository?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {remote
              ? `This will change ${props.workspace.full_name} on GitHub. Misty will use a single-use credential only for this confirmed action.`
              : "Misty will stop syncing GitHub metadata. The local folder will remain untouched."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={props.onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={props.onConfirm}>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
