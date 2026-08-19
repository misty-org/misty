import type { GitHubInstallation, GitHubRepository } from "@/api/integrations/github";
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
  AlertDialogTrigger,
  Badge,
  Button,
} from "@/shared/ui";
import { ExternalLink, GitFork, LoaderCircle, Unplug } from "lucide-react";
import { FaGithub } from "react-icons/fa6";
import { useGitHubCodeStore } from "./useGitHubCodeStore";

export function GitHubInstallations(props: {
  spaceId: string;
  canManage: boolean;
  localWorkspaceId: string;
  onInstall: () => Promise<void>;
}) {
  const state = useGitHubCodeStore();

  return (
    <section
      className="rounded-xl border border-charcoal-border bg-charcoal-card"
      aria-label="GitHub accounts"
    >
      <header className="flex items-center justify-between gap-3 border-b border-charcoal-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <FaGithub className="size-5 shrink-0 text-cream-bright" aria-hidden />
          <div>
            <h3 className="text-sm font-medium text-cream-bright">GitHub App</h3>
            <p className="mt-0.5 text-xs text-cream-muted">
              Repository-scoped access, managed by GitHub
            </p>
          </div>
        </div>
        {props.canManage ? (
          <Button size="sm" onClick={() => void props.onInstall()}>
            {state.installations.length ? "Add account" : "Install"}
          </Button>
        ) : null}
      </header>

      {state.loading ? (
        <div className="flex items-center gap-2 p-4 text-sm text-cream-muted">
          <LoaderCircle className="size-4 animate-spin" /> Checking GitHub…
        </div>
      ) : !state.installations.length ? (
        <p className="m-0 p-4 text-sm text-cream-muted">
          {props.canManage
            ? "Install the Misty GitHub App to choose repositories for this Space."
            : "A Space manager has not connected GitHub yet."}
        </p>
      ) : (
        <div className="divide-y divide-charcoal-border">
          {state.installations.map((installation) => (
            <InstallationRow key={installation.id} {...props} installation={installation} />
          ))}
        </div>
      )}
      {state.error ? (
        <p
          className="m-0 border-t border-charcoal-border px-4 py-3 text-xs text-[#d68b80]"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
    </section>
  );
}

function InstallationRow(props: {
  spaceId: string;
  canManage: boolean;
  localWorkspaceId: string;
  onInstall: () => Promise<void>;
  installation: GitHubInstallation;
}) {
  const state = useGitHubCodeStore();
  const repositories = state.repositoriesByInstallation[props.installation.id];
  const active = props.installation.status === "active";

  return (
    <div className="grid gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-cream-bright">
          {props.installation.account_login}
        </span>
        <Badge variant={active ? "secondary" : "outline"}>
          {active ? "Connected" : statusLabel(props.installation.status)}
        </Badge>
        {props.canManage && !active ? (
          <Button size="sm" variant="outline" onClick={() => void props.onInstall()}>
            Reconnect
          </Button>
        ) : null}
        {props.canManage ? <DisconnectButton {...props} /> : null}
      </div>
      {props.installation.last_error_code ? (
        <p className="m-0 text-xs text-[#d68b80]">
          GitHub needs attention ({props.installation.last_error_code.split("_").join(" ")}).
        </p>
      ) : null}
      {active && props.canManage ? (
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={state.busy === `discover:${props.installation.id}`}
            onClick={() => void state.discover(props.spaceId, props.installation.id)}
          >
            {state.busy === `discover:${props.installation.id}` ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <GitFork className="size-4" />
            )}
            {repositories ? "Refresh repositories" : "Choose repositories"}
          </Button>
        </div>
      ) : null}
      {repositories ? (
        <RepositoryChoices
          repositories={repositories}
          installation={props.installation}
          spaceId={props.spaceId}
          localWorkspaceId={props.localWorkspaceId}
        />
      ) : null}
    </div>
  );
}

function RepositoryChoices(props: {
  repositories: GitHubRepository[];
  installation: GitHubInstallation;
  spaceId: string;
  localWorkspaceId: string;
}) {
  const state = useGitHubCodeStore();
  if (!props.repositories.length) {
    return <p className="m-0 text-xs text-cream-muted">No readable repositories were granted.</p>;
  }
  return (
    <div className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border border-charcoal-border p-1.5">
      {props.repositories.map((repository) => {
        const linked = state.workspaces.find((item) => item.repository_id === repository.id);
        return (
          <div
            key={repository.id}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-charcoal-hover"
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-xs text-cream hover:underline"
              onClick={() => void openExternalLink(repository.html_url)}
            >
              {repository.full_name}
              {repository.private ? " · private" : ""}
            </button>
            <ExternalLink className="size-3 text-cream-muted" aria-hidden />
            <Button
              size="sm"
              variant="outline"
              disabled={Boolean(linked) || state.busy === "bind"}
              onClick={() =>
                void state
                  .bind(props.spaceId, props.installation.id, repository.id, props.localWorkspaceId)
                  .catch(() => undefined)
              }
            >
              {linked ? "Linked" : props.localWorkspaceId ? "Link here" : "Link"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function DisconnectButton(props: { spaceId: string; installation: GitHubInstallation }) {
  const state = useGitHubCodeStore();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Unplug className="size-4" /> Disconnect
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="code-theme-overlay">
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect {props.installation.account_login}?</AlertDialogTitle>
          <AlertDialogDescription>
            Misty will stop syncing its repositories. Local folders and commits will not be deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => void state.disconnect(props.spaceId, props.installation.id)}
          >
            Disconnect
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function statusLabel(status: GitHubInstallation["status"]): string {
  if (status === "needs_attention") return "Needs attention";
  return status.charAt(0).toUpperCase() + status.slice(1);
}
