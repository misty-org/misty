// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * Settings › Engines › CLIs: each engine CLI's version on this computer, the latest one on npm,
 * whether the person is signed in (as the CLI itself says), and installing or updating it.
 *
 * One row per engine: its mark and name, then its sign-in pill with a sign-in button while it is
 * signed out (the CLI's own login, in a terminal), a status pill (checking, not installed, or the
 * version with a check or an arrow), the install or update button naming the target, and the
 * docs and refresh buttons, and, for an engine Misty installed in `~/.misty/engines`, Remove in
 * the row's ⋯ menu. Versions are checked when the page opens and on refresh, never on a timer.
 */
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUp, BookOpen, Check, Download, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { EngineMark, hasEngineMark } from "../EngineMark";
import { DesktopSettingsSection as Section } from "@/features/settings";
import {
  Badge,
  Button,
  cn,
  ConfirmDeleteDialog,
  MenuItem,
  SkeletonControl,
  IconButton,
  RowActions,
  Text,
  Tooltip,
} from "@/shared/ui";
import { ENGINE_DOCS_URLS, ENGINE_IDS, ENGINE_NAMES, type EngineId } from "../channels/engines";
import { cliApi, type CliVersionStatus } from "./api";
import { CliUpdateDialog } from "./CliUpdateDialog";
import { SignInButton } from "./SignInButton";
import { SignInDialog } from "./SignInDialog";
import { useCliUpdateFlow } from "./useCliUpdateFlow";
import { refreshCliStatus, useCliVersionStatus } from "./useCliVersionStatus";

function openDocs(url: string) {
  void openUrl(url).catch(() => {});
}

function VersionPill({ status, error }: { status: CliVersionStatus | null; error: string | null }) {
  if (status === null) {
    return error ? (
      <Tooltip content={error}>
        <Badge variant="outline">Check failed</Badge>
      </Tooltip>
    ) : (
      <SkeletonControl kind="badge" className="w-16" />
    );
  }
  if (!status.installed) return <Badge variant="outline">Not installed</Badge>;
  if (!status.localVersion) return <Badge variant="outline">Installed</Badge>;
  return (
    <Badge variant="outline">
      {status.updateAvailable ? (
        <ArrowUp aria-label="Update available" />
      ) : status.latestVersion ? (
        <Check aria-label="Up to date" />
      ) : null}
      v{status.localVersion.replace(/^v/, "")}
    </Badge>
  );
}

function SignInPill({ signedIn, detail }: { signedIn: boolean | null; detail: string | null }) {
  if (signedIn === null) return null;
  return (
    <Tooltip content={detail ?? ""}>
      <Badge variant="outline">{signedIn ? "Signed in" : "Signed out"}</Badge>
    </Tooltip>
  );
}

function CliRow({ engine }: { engine: EngineId }) {
  const { status, signIn, loading, error, updating, refresh } = useCliVersionStatus(engine);
  const flow = useCliUpdateFlow(engine);
  const name = ENGINE_NAMES[engine];
  const canAct =
    status !== null && status.updateKind !== null && (!status.installed || status.updateAvailable);
  // The sign-in to start, or null. Some engines ask which region or provider first.
  const [signingIn, setSigningIn] = useState<{ provider?: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  // Only a copy Misty installed can go; one that was on the computer before is the person's own.
  const canRemove = status?.installedByMisty === true && !updating;
  // Signed out, or a CLI that can't say: its own login is a click away. DeepSeek Harness keeps
  // its providers in its own web page (Channels › DeepSeek Harness).
  const canSignIn =
    status?.installed === true && signIn !== null && signIn.signedIn !== true && engine !== "dsh";
  return (
    <div className="group/row flex min-h-13 items-center gap-3 border-b px-3 py-2.5 last:border-b-0">
      <Text bare tone="default" className="flex size-8 shrink-0 items-center justify-center">
        {hasEngineMark(engine) ? (
          <EngineMark engine={engine} size={16} />
        ) : (
          <span className="text-xs font-semibold">{name.charAt(0)}</span>
        )}
      </Text>
      <Text as="p" tone="bright" full className="min-w-0 flex-1 text-sm">
        {ENGINE_NAMES[engine]}
      </Text>
      {/* Before the first probe answers, the sign-in pill and the install button hold their
          places, so the row doesn't move when they arrive. */}
      {status === null && !error ? <SkeletonControl kind="badge" className="w-16" /> : null}
      <SignInPill
        signedIn={status?.installed ? (signIn?.signedIn ?? null) : null}
        detail={signIn?.detail ?? null}
      />
      {canSignIn ? (
        <SignInButton engine={engine} disabled={updating} onSignIn={setSigningIn} />
      ) : null}
      <VersionPill status={status} error={error} />
      {status === null && !error ? <SkeletonControl kind="button" /> : null}
      {canAct ? (
        <Button variant="primary" disabled={updating || loading} onClick={() => void flow.begin()}>
          {updating ? null : status.installed ? <ArrowUp /> : <Download />}
          {updating
            ? "Updating"
            : status.installed
              ? `Update to ${status.latestVersion ?? "latest"}`
              : "Install"}
        </Button>
      ) : null}
      <IconButton
        label={`${ENGINE_NAMES[engine]} docs`}
        onClick={() => openDocs(ENGINE_DOCS_URLS[engine])}
      >
        <BookOpen />
      </IconButton>
      <IconButton
        label={`Check ${ENGINE_NAMES[engine]} again`}
        disabled={loading || updating}
        onClick={refresh}
      >
        <RefreshCw className={cn(loading && "animate-spin")} />
      </IconButton>
      {canRemove ? (
        <RowActions label={`${name} actions`}>
          <MenuItem icon={Trash2} label="Remove" danger onSelect={() => setRemoving(true)} />
        </RowActions>
      ) : null}
      <ConfirmDeleteDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${name}?`}
        what={`Misty deletes the copy it installed. ${name}'s sign-in and settings stay, and you can install it again.`}
        confirmLabel="Remove"
        onConfirm={async () => {
          await cliApi.remove(engine);
          await refreshCliStatus(engine);
        }}
      />
      <CliUpdateDialog engine={engine} flow={flow} />
      <SignInDialog
        request={signingIn ? { engine, ...signingIn } : null}
        onClose={() => {
          setSigningIn(null);
          refresh();
        }}
      />
    </div>
  );
}

/** Settings › Engines › CLIs. */
export function ClisSection() {
  return (
    <Section title="CLIs">
      {ENGINE_IDS.map((engine) => (
        <CliRow key={engine} engine={engine} />
      ))}
    </Section>
  );
}
