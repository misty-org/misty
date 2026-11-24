// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUp, BookOpen, Download, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { DesktopSettingsRow, DesktopSettingsSection as Section } from "@/features/settings";
import {
  Button,
  ConfirmDeleteDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  hasMark,
  LogoInitial,
  Mark,
  MenuItem,
  MenuTrigger,
  SetupState,
  Text,
  Tooltip,
} from "@misty/ui";
import { ENGINE_DOCS_URLS, ENGINE_IDS, ENGINE_NAMES, type EngineId } from "../channels/engines";
import { cliApi, type CliRemoveKind, type CliVersionStatus } from "./api";
import { CliUpdateDialog } from "./CliUpdateDialog";
import { SignInButton } from "./SignInButton";
import { SignInDialog } from "./SignInDialog";
import { useCliUpdateFlow } from "./use_cli_update_flow";
import { refreshCliStatus, useCliVersionStatus } from "./use_cli_version_status";

function openDocs(url: string) {
  void openUrl(url).catch(() => {});
}

export function versionText(raw: string): string {
  const number = raw.match(/\d+(?:\.\d+)+(?:-[0-9A-Za-z.]+)?/);
  return `v${number ? number[0] : raw.trim().replace(/^v/i, "")}`;
}

function uninstallText(kind: CliRemoveKind, name: string): string {
  const stays = `${name}'s sign-in and settings stay, and you can install it again.`;
  switch (kind) {
    case "misty":
      return `Misty deletes the copy it installed. ${stays}`;
    case "npm":
      return `npm uninstalls it from this computer. ${stays}`;
    case "brew":
      return `Homebrew uninstalls it from this computer. ${stays}`;
    case "maker":
      return `Misty deletes the program and the versions its installer kept. ${stays}`;
  }
}

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
        <span>{signedIn ? "signed in" : "signed out"}</span>
      </Tooltip>,
    );
  if (status.updateAvailable && status.latestVersion)
    facts.push(`${versionText(status.latestVersion)} available`);
  return (
    <>
      {facts.map((fact, index) => (
        <Fragment key={index}>
          {index ? ", " : null}
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
  const checking = status === null && !error;
  const canAct =
    status !== null && status.updateKind !== null && (!status.installed || status.updateAvailable);
  const [signingIn, setSigningIn] = useState(false);
  const [removing, setRemoving] = useState<{ open: boolean; kind: CliRemoveKind }>({
    open: false,
    kind: "misty",
  });
  const removeKind = updating ? null : (status?.removeKind ?? null);
  const canSignIn = status?.installed === true && signIn !== null && signIn.signedIn !== true;
  const installing = canAct && !status.installed;
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
    action = <SignInButton disabled={updating} onSignIn={() => setSigningIn(true)} />;
  return (
    <>
      <DesktopSettingsRow
        label={name}
        leading={
          <Text bare tone="default" className="flex size-8 shrink-0 items-center justify-center">
            {hasMark(`engine:${engine}`) ? (
              <Mark of={`engine:${engine}`} size={16} />
            ) : (
              <LogoInitial name={name} />
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
            {removeKind ? (
              <>
                <DropdownMenuSeparator />
                <MenuItem
                  icon={Trash2}
                  label="Uninstall"
                  danger
                  onSelect={() => setRemoving({ open: true, kind: removeKind })}
                />
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </DesktopSettingsRow>
      <ConfirmDeleteDialog
        open={removing.open}
        onOpenChange={(open) => setRemoving((current) => ({ ...current, open }))}
        title={`Uninstall ${name}?`}
        what={uninstallText(removing.kind, name)}
        confirmLabel="Uninstall"
        onConfirm={async () => {
          await cliApi.remove(engine);
          await refreshCliStatus(engine);
        }}
      />
      <CliUpdateDialog engine={engine} flow={flow} />
      <SignInDialog
        request={signingIn ? { engine } : null}
        onClose={() => {
          setSigningIn(false);
          refresh();
        }}
      />
    </>
  );
}

export function ClisSection() {
  return (
    <Section title="CLIs">
      {ENGINE_IDS.map((engine) => (
        <CliRow key={engine} engine={engine} />
      ))}
    </Section>
  );
}
