import { BookOpen, ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import { ENGINE_DOCS_URLS, ENGINE_IDS, type EngineId } from "@/features/engine-config/channels";
import {
  cliApi,
  CliUpdateDialog,
  refreshCliStatus,
  SignInButton,
  SignInDialog,
  hasCliUpdate,
  uninstallText,
  useCliStatuses,
  useCliUpdateFlow,
  useCliVersionStatus,
  versionText,
} from "@/features/engine-config/clis";
import { openExternalLink } from "@/shared/platform/open_external_link";
import {
  Button,
  CatalogNames,
  ConfirmDeleteDialog,
  EmptyState,
  LogoTile,
  Mark,
  MenuItem,
  SettingsRow,
  SettingsSection,
  StoreCard,
  StoreCards,
  StoreInfo,
  StoreSection,
  StoreSheet,
  StoreSheetSection,
  StoreSkeleton,
} from "@misty/ui";
import { listEngines } from "../engines/engines_api";
import { usePersonalAgentsStore } from "../personal/personal_agents_store";
import {
  installRouteText,
  useRegistryEngineIds,
  useRegistryEngines,
  type CatalogEngine,
} from "./engine_catalog";
import { useExploreNav, type BarAction } from "./explore_view";
import { ActionButton } from "./ListingRows";
import { sourceLabel } from "./PluginMaker";

const isEngineId = (id: string): id is EngineId => ENGINE_IDS.some((engine) => engine === id);

export function EngineTile({
  engine,
  size = "item",
}: {
  engine: CatalogEngine;
  size?: "item" | "sheet";
}) {
  return (
    <LogoTile size={size}>
      <Mark
        of={`engine:${engine.id}`}
        label={engine.name}
        size={size === "sheet" ? 63 : 36}
        aria-hidden
      />
    </LogoTile>
  );
}

type SignInAsk = { provider?: string; signOut?: boolean };

function useEngine(engine: CatalogEngine) {
  const { status, signIn, loading, updating, refresh } = useCliVersionStatus(engine.id);
  const flow = useCliUpdateFlow(engine.id, { onSuccess: () => void listEngines() });
  const [signingIn, setSigningIn] = useState<SignInAsk | null>(null);
  const installed = status?.installed === true;
  const busy =
    updating || loading || flow.state.status === "planning" || flow.state.status === "running";
  const canInstall =
    !installed &&
    engine.install.route !== "none" &&
    (status === null || status.updateKind !== null);
  const canUpdate = installed && hasCliUpdate(status);
  const signedOut = installed && signIn?.signedIn === false;
  let action: BarAction | null = null;
  if (canInstall)
    action = { label: "Get", variant: "get", disabled: busy, onClick: () => void flow.begin() };
  else if (canUpdate)
    action = { label: "Update", variant: "get", disabled: busy, onClick: () => void flow.begin() };
  const by = engine.maker ? `, by ${engine.maker}` : "";
  let line = installed ? `Ready${by}` : `Not installed${by}`;
  let state: "on" | "waiting" | "off" = installed ? "on" : "off";
  if (updating) {
    line = installed ? "Updating" : "Installing";
    state = "waiting";
  } else if (signedOut) {
    line = `Signed out${by}`;
    state = "off";
  } else if (installed && signIn?.signedIn) line = `Signed in${by}`;
  const dialogs = (
    <>
      <CliUpdateDialog engine={engine.id} flow={flow} />
      <SignInDialog
        request={signingIn ? { engine: engine.id, ...signingIn } : null}
        onClose={() => {
          setSigningIn(null);
          refresh();
        }}
      />
    </>
  );
  return {
    status,
    signIn,
    installed,
    busy,
    updating,
    canUpdate,
    signedOut,
    action,
    line,
    state,
    flow,
    refresh,
    setSigningIn,
    dialogs,
  };
}

type EngineState = ReturnType<typeof useEngine>;

function EngineAction({
  engine,
  state,
  size = "sm",
}: {
  engine: CatalogEngine;
  state: EngineState;
  size?: "sm" | "md";
}) {
  if (state.action) return <ActionButton action={state.action} size={size} label={engine.name} />;
  if (!state.signedOut) return null;
  return (
    <SignInButton
      engine={engine.id}
      size={size}
      label={`Sign in to ${engine.name}`}
      disabled={state.updating}
      onSignIn={state.setSigningIn}
    />
  );
}

export function EngineCard({ engine }: { engine: CatalogEngine }) {
  const nav = useExploreNav();
  const state = useEngine(engine);
  return (
    <>
      <StoreCard
        logo={<EngineTile engine={engine} />}
        title={engine.name}
        line={state.line}
        state={state.state}
        action={<EngineAction engine={engine} state={state} />}
        onOpen={() => nav.open({ kind: "engines", id: engine.id })}
      />
      {state.dialogs}
    </>
  );
}

export function EnginesPage() {
  const engines = useRegistryEngines();
  const { statuses, settled } = useCliStatuses(useRegistryEngineIds());
  if (!engines.length)
    return <EmptyState inline title="No engines listed" line="Misty's registry lists none yet." />;
  if (!settled && engines.every((engine) => statuses[engine.id] === null))
    return (
      <>
        <StoreSkeleton label="Engines" look="cards" items={4} />
        <StoreSkeleton label="Engines" look="cards" items={2} />
      </>
    );
  const here = engines.filter((engine) => statuses[engine.id]?.installed);
  const rest = engines.filter((engine) => !statuses[engine.id]?.installed);
  return (
    <>
      {here.length ? (
        <StoreSection
          title="On this computer"
          detail={here.length === 1 ? "1 engine" : `${here.length} engines`}
        >
          <StoreCards label="On this computer">
            {here.map((engine) => (
              <EngineCard key={engine.id} engine={engine} />
            ))}
          </StoreCards>
        </StoreSection>
      ) : null}
      {rest.length ? (
        <StoreSection title="More engines">
          <StoreCards label="More engines">
            {rest.map((engine) => (
              <EngineCard key={engine.id} engine={engine} />
            ))}
          </StoreCards>
        </StoreSection>
      ) : null}
    </>
  );
}

export function EngineSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const engine = useRegistryEngines().find((one) => one.id === id);
  return engine ? <EngineSheetBody engine={engine} onClose={onClose} /> : null;
}

function EngineSheetBody({ engine, onClose }: { engine: CatalogEngine; onClose: () => void }) {
  const state = useEngine(engine);
  const agents = usePersonalAgentsStore((store) => store.agents).filter(
    (agent) => agent.engine === engine.id,
  );
  const [removing, setRemoving] = useState(false);
  const docs = isEngineId(engine.id) ? ENGINE_DOCS_URLS[engine.id] : undefined;
  const version = state.status?.localVersion ? versionText(state.status.localVersion) : null;
  const removeKind = state.updating ? null : (state.status?.removeKind ?? null);
  const status = !state.installed
    ? "Not installed"
    : state.signIn?.signedIn === false
      ? "Signed out"
      : state.signIn?.signedIn
        ? "Signed in"
        : "Ready";
  return (
    <StoreSheet
      open
      onOpenChange={(open) => !open && onClose()}
      logo={<EngineTile engine={engine} size="sheet" />}
      title={engine.name}
      maker={engine.maker}
      action={<EngineAction engine={engine} state={state} size="md" />}
      menu={
        <>
          {engine.source ? (
            <MenuItem
              icon={ExternalLink}
              label="Open website"
              onSelect={() => void openExternalLink(engine.source ?? "")}
            />
          ) : null}
          {docs ? (
            <MenuItem icon={BookOpen} label="Docs" onSelect={() => void openExternalLink(docs)} />
          ) : null}
          <MenuItem
            icon={RefreshCw}
            label="Check again"
            disabled={state.busy}
            onSelect={state.refresh}
          />
        </>
      }
      facts={[
        { label: "Status", value: status },
        ...(version ? [{ label: "Version", value: version }] : []),
        ...(state.signIn?.detail ? [{ label: "Plan", value: state.signIn.detail }] : []),
        { label: "Installs", value: installRouteText(engine.install.route) },
      ]}
    >
      {state.installed ? (
        <SettingsSection title="Account">
          {state.signIn ? (
            <SettingsRow
              label={
                state.signIn.signedIn ? "Signed in with your own account" : "Not signed in yet"
              }
            >
              {state.signIn.signedIn ? (
                <Button
                  variant="quiet"
                  size="sm"
                  disabled={state.updating}
                  onClick={() => state.setSigningIn({ signOut: true })}
                >
                  Sign out
                </Button>
              ) : (
                <SignInButton
                  engine={engine.id}
                  size="sm"
                  label={`Sign in to ${engine.name}`}
                  disabled={state.updating}
                  onSignIn={state.setSigningIn}
                />
              )}
            </SettingsRow>
          ) : null}
          <SettingsRow
            label={version ? `Version ${version}` : "Version"}
            description={
              state.canUpdate && state.status?.latestVersion
                ? `${versionText(state.status.latestVersion)} is out`
                : "Up to date"
            }
          >
            <Button
              size="sm"
              disabled={state.busy}
              onClick={() => (state.canUpdate ? void state.flow.begin() : state.refresh())}
            >
              {state.canUpdate ? "Update" : "Check for updates"}
            </Button>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {agents.length ? (
        <StoreSheetSection title="Agents on this engine">
          <CatalogNames names={agents.map((agent) => agent.name)} />
        </StoreSheetSection>
      ) : null}
      <StoreSheetSection title="Information">
        <StoreInfo
          items={[
            ...(engine.maker ? [{ label: "Made by", value: engine.maker }] : []),
            ...(engine.source ? [{ label: "Source", value: sourceLabel(engine.source) }] : []),
            { label: "Installs", value: installRouteText(engine.install.route) },
          ]}
        />
      </StoreSheetSection>
      {removeKind ? (
        <div>
          <Button variant="danger" onClick={() => setRemoving(true)}>
            Uninstall
          </Button>
        </div>
      ) : null}
      <ConfirmDeleteDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Uninstall ${engine.name}?`}
        what={uninstallText(removeKind ?? "misty", engine.name)}
        confirmLabel="Uninstall"
        onConfirm={async () => {
          await cliApi.remove(engine.id);
          await refreshCliStatus(engine.id);
          void listEngines();
        }}
      />
      {state.dialogs}
    </StoreSheet>
  );
}
