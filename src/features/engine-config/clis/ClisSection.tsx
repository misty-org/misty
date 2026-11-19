// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * Agents › CLIs: each engine CLI's version on this computer, the latest one on npm,
 * whether the person is signed in (as the CLI itself says), and installing or updating it.
 *
 * One settings row per engine: its mark and name, one quiet line under the name with what is true
 * (its version, signed in or out, an update waiting), then at most one button for what to do next
 * (Install, else Sign in, else Update), and a ⋯ menu with the rest: updating when Sign in took the
 * button, the docs, checking again and, for an engine Misty installed in `~/.misty/shared/engines`,
 * Remove. Versions are checked when the page opens and on refresh, never on a timer.
 */
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUp, BookOpen, Download, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { EngineMark, hasEngineMark } from "../EngineMark";
import { DesktopSettingsRow, DesktopSettingsSection as Section } from "@/features/settings";
import {
  Button,
  ConfirmDeleteDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  MenuItem,
  MenuTrigger,
  SetupState,
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

/**
 * A version as people read it. CLIs print theirs in their own words ("codex-cli 0.147.0",
 * "2.1.325 (Claude Code)", "grok 1.0.77 (50ca579fa996)"); only the number is kept.
 */
export function versionText(raw: string): string {
  const number = raw.match(/\d+(?:\.\d+)+(?:-[0-9A-Za-z.]+)?/);
  return `v${number ? number[0] : raw.trim().replace(/^v/i, "")}`;
}

/** The row's one line under the name: what is true about this CLI now. */
function StatusLine({
  status,
  error,
  signedIn,
  signInDetail,
}: {
  status: CliVersionStatus | null;
  error: string | null;
  signedIn: boolean | null;
  signInDetail: string | null;
}) {
  if (status === null) {
    // Until the first check answers, the row's control says it is checking.
    return error ? (
      <Tooltip content={error}>
        <span>Couldn’t check</span>
      </Tooltip>
    ) : null;
  }
  if (!status.installed) return <>Not installed</>;
  const facts: ReactNode[] = [status.localVersion ? versionText(status.localVersion) : "Installed"];
  if (signedIn !== null)
    facts.push(
      <Tooltip key="sign-in" content={signInDetail ?? ""}>
        <span>{signedIn ? "Signed in" : "Signed out"}</span>
      </Tooltip>,
    );
  if (status.updateAvailable && status.latestVersion)
    facts.push(`${versionText(status.latestVersion)} available`);
  return (
    <>
      {facts.map((fact, index) => (
        <Fragment key={index}>
          {index ? " · " : null}
          {fact}
        </Fragment>
      ))}
    </>
  );
}

function CliRow({ engine }: { engine: EngineId }) {
  const { status, signIn, loading, error, updating, refresh } = useCliVersionStatus(engine);
  const flow = useCliUpdateFlow(engine);
  const name = ENGINE_NAMES[engine];
  // The CLI's `--version` probe hasn't answered yet.
  const checking = status === null && !error;
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
  const installing = canAct && !status.installed;
  // One button: Install, else Sign in, else Update. An update Sign in pushed out is in the menu.
  const updateInMenu = canAct && status.installed && canSignIn && !updating;
  const updateLabel = `Update to ${status?.latestVersion ? versionText(status.latestVersion) : "latest"}`;
  let action: ReactNode = null;
  if (installing || (canAct && !canSignIn) || updating)
    action = (
      <Button
        icon={installing ? Download : ArrowUp}
        disabled={updating || loading}
        onClick={() => void flow.begin()}
      >
        {updating ? "Updating" : installing ? "Install" : updateLabel}
      </Button>
    );
  else if (canSignIn)
    action = <SignInButton engine={engine} disabled={updating} onSignIn={setSigningIn} />;
  return (
    <>
      <DesktopSettingsRow
        label={name}
        leading={
          <Text bare tone="default" className="flex size-8 shrink-0 items-center justify-center">
            {hasEngineMark(engine) ? (
              <EngineMark engine={engine} size={16} />
            ) : (
              <span className="text-xs font-semibold">{name.charAt(0)}</span>
            )}
          </Text>
        }
        description={
          checking ? undefined : (
            <StatusLine
              status={status}
              error={error}
              signedIn={status?.installed ? (signIn?.signedIn ?? null) : null}
              signInDetail={signIn?.detail ?? null}
            />
          )
        }
      >
        {checking ? (
          <SetupState size="row" tool="check" label={`Checking ${name}`} onRetry={refresh} />
        ) : (
          action
        )}
        <DropdownMenu>
          <MenuTrigger label={`${name} actions`} iconOnly icon={MoreHorizontal} />
          <DropdownMenuContent align="end">
            {updateInMenu ? (
              <MenuItem
                icon={ArrowUp}
                label={updateLabel}
                disabled={loading}
                onSelect={() => void flow.begin()}
              />
            ) : null}
            <MenuItem
              icon={BookOpen}
              label="Docs"
              onSelect={() => openDocs(ENGINE_DOCS_URLS[engine])}
            />
            <MenuItem
              icon={RefreshCw}
              label="Check again"
              disabled={loading || updating}
              onSelect={refresh}
            />
            {canRemove ? (
              <>
                <DropdownMenuSeparator />
                <MenuItem icon={Trash2} label="Remove" danger onSelect={() => setRemoving(true)} />
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </DesktopSettingsRow>
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
    </>
  );
}

/** Agents › CLIs. */
export function ClisSection() {
  return (
    <Section title="CLIs">
      {ENGINE_IDS.map((engine) => (
        <CliRow key={engine} engine={engine} />
      ))}
    </Section>
  );
}
