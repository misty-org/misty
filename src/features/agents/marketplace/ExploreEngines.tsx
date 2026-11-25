import { BookOpen, ExternalLink, RefreshCw, Settings2 } from "lucide-react";
import { useState } from "react";
import { ENGINE_DOCS_URLS, ENGINE_IDS, type EngineId } from "@/features/engine-config/channels";
import {
  CliUpdateDialog,
  SignInButton,
  SignInDialog,
  hasCliUpdate,
  useCliStatuses,
  useCliUpdateFlow,
  useCliVersionStatus,
  versionText,
} from "@/features/engine-config/clis";
import { openExternalLink } from "@/shared/platform/open_external_link";
import {
  Button,
  EmptyState,
  LogoTile,
  Mark,
  MenuItem,
  ProductInfo,
  ProductPage,
  ProductSection,
  SettingsRow,
  SettingsSection,
  Shelf,
  ShelfItem,
  ShelfSkeleton,
} from "@misty/ui";
import { listEngines } from "../engines/engines_api";
import {
  installRouteText,
  useRegistryEngineIds,
  useRegistryEngines,
  type CatalogEngine,
} from "./engine_catalog";
import { useBarAction, useExploreNav, type BarAction } from "./explore_view";
import { ActionButton } from "./ListingRows";
import { sourceLabel } from "./PluginMaker";

const isEngineId = (id: string): id is EngineId => ENGINE_IDS.some((engine) => engine === id);

export function EngineTile({
  engine,
  size = "tile",
}: {
  engine: CatalogEngine;
  size?: "tile" | "hero";
}) {
  return (
    <LogoTile size={size}>
      <Mark
        of={`engine:${engine.id}`}
        label={engine.name}
        size={size === "hero" ? 81 : 40}
        aria-hidden
      />
    </LogoTile>
  );
}

function useEngine(engine: CatalogEngine) {
  const nav = useExploreNav();
  const { status, signIn, loading, updating, refresh } = useCliVersionStatus(engine.id);
  const flow = useCliUpdateFlow(engine.id, { onSuccess: () => void listEngines() });
  const [signingIn, setSigningIn] = useState<{ provider?: string } | null>(null);
  const installed = status?.installed === true;
  const busy =
    updating || loading || flow.state.status === "planning" || flow.state.status === "running";
  const canInstall =
    !installed &&
    engine.install.route !== "none" &&
    (status === null || status.updateKind !== null);
  const canUpdate = installed && hasCliUpdate(status);
  let action: BarAction | null = null;
  if (canInstall)
    action = { label: "Get", variant: "get", disabled: busy, onClick: () => void flow.begin() };
  else if (canUpdate)
    action = { label: "Update", variant: "get", disabled: busy, onClick: () => void flow.begin() };
  else if (installed)
    action = {
      label: "Manage",
      variant: "secondary",
      onClick: () => nav.manage({ kind: "engines", id: engine.id }),
    };
  let line = engine.maker ? `By ${engine.maker}` : "";
  if (updating) line = installed ? "Updating" : "Installing";
  else if (installed && signIn?.signedIn === false) line = "Signed out";
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
    action,
    line,
    flow,
    refresh,
    setSigningIn,
    dialogs,
  };
}

function EngineItem({ engine }: { engine: CatalogEngine }) {
  const nav = useExploreNav();
  const state = useEngine(engine);
  return (
    <>
      <ShelfItem
        logo={<EngineTile engine={engine} />}
        title={engine.name}
        line={state.line || undefined}
        action={<ActionButton action={state.action} />}
        menu={
          engine.source ? (
            <MenuItem
              icon={ExternalLink}
              label="Open website"
              onSelect={() => void openExternalLink(engine.source ?? "")}
            />
          ) : undefined
        }
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
        <ShelfSkeleton label="Engines" />
        <ShelfSkeleton label="Engines" />
      </>
    );
  const here = engines.filter((engine) => statuses[engine.id]?.installed);
  const rest = engines.filter((engine) => !statuses[engine.id]?.installed);
  return (
    <>
      {here.length ? (
        <Shelf title="On this computer">
          {here.map((engine) => (
            <EngineItem key={engine.id} engine={engine} />
          ))}
        </Shelf>
      ) : null}
      {rest.length ? (
        <Shelf title="More engines">
          {rest.map((engine) => (
            <EngineItem key={engine.id} engine={engine} />
          ))}
        </Shelf>
      ) : null}
    </>
  );
}

export function EngineProduct({ id }: { id: string }) {
  const engine = useRegistryEngines().find((one) => one.id === id);
  if (!engine)
    return (
      <EmptyState
        inline
        title="This engine isn't listed any more"
        line="Misty's registry no longer has it."
      />
    );
  return <EngineProductPage engine={engine} />;
}

function EngineProductPage({ engine }: { engine: CatalogEngine }) {
  const nav = useExploreNav();
  const state = useEngine(engine);
  useBarAction(state.action, engine.name);
  const docs = isEngineId(engine.id) ? ENGINE_DOCS_URLS[engine.id] : undefined;
  const version = state.status?.localVersion ? versionText(state.status.localVersion) : null;
  return (
    <ProductPage
      logo={<EngineTile engine={engine} size="hero" />}
      title={engine.name}
      line={engine.maker ? `An engine by ${engine.maker}` : undefined}
      maker={engine.maker}
      action={<ActionButton action={state.action} size="md" />}
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
          {state.installed ? (
            <MenuItem
              icon={Settings2}
              label="Manage"
              onSelect={() => nav.manage({ kind: "engines", id: engine.id })}
            />
          ) : null}
          <MenuItem
            icon={RefreshCw}
            label="Check again"
            disabled={state.busy}
            onSelect={state.refresh}
          />
        </>
      }
      onHeroOut={nav.setPinned}
      facts={[
        ...(engine.maker ? [{ label: "Made by", value: engine.maker }] : []),
        {
          label: "Status",
          value: !state.installed
            ? "Not here"
            : state.signIn?.signedIn === false
              ? "Sign in"
              : "Ready",
        },
        ...(version ? [{ label: "Version", value: version }] : []),
        { label: "Installs", value: installRouteText(engine.install.route) },
      ]}
    >
      <ProductSection title="Information">
        <ProductInfo
          items={[
            ...(engine.maker ? [{ label: "Made by", value: engine.maker }] : []),
            ...(engine.source ? [{ label: "Source", value: sourceLabel(engine.source) }] : []),
            { label: "Installs", value: installRouteText(engine.install.route) },
          ]}
        />
      </ProductSection>
      {state.dialogs}
    </ProductPage>
  );
}

export function EngineManage({ id }: { id: string }) {
  const engine = useRegistryEngines().find((one) => one.id === id);
  return engine ? <EngineManageRows engine={engine} /> : null;
}

function EngineManageRows({ engine }: { engine: CatalogEngine }) {
  const state = useEngine(engine);
  const version = state.status?.localVersion ? versionText(state.status.localVersion) : null;
  if (!state.installed) return null;
  return (
    <>
      <SettingsSection title={engine.name}>
        {state.signIn ? (
          <SettingsRow
            label="Signed in"
            description={state.signIn.signedIn ? "With your own account" : "Not yet"}
          >
            {state.signIn.signedIn ? null : (
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
      {state.dialogs}
    </>
  );
}
