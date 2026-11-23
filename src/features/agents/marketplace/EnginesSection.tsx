import { ArrowUp, BookOpen, ExternalLink, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
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
  CatalogDone,
  EmptyState,
  LogoTile,
  Mark,
  MenuItem,
  Shelf,
  ShelfItem,
  StoreDetail,
} from "@misty/ui";
import { listEngines } from "../engines/engines_api";
import {
  engineMatches,
  installRouteText,
  useRegistryEngineIds,
  useRegistryEngines,
  type CatalogEngine,
} from "./engine_catalog";
import { MarketShelf, MarketShelvesSkeleton } from "./MarketShelf";
import { sourceLabel } from "./PluginMaker";

const isEngineId = (id: string): id is EngineId => ENGINE_IDS.some((engine) => engine === id);

export function EnginesSection({ query }: { query: string }) {
  const engines = useRegistryEngines();
  const { statuses, settled } = useCliStatuses(useRegistryEngineIds());
  const shown = engines.filter((engine) => engineMatches(engine, query));
  if (!shown.length) return <EmptyState inline title="No engines found" line="Try other words." />;
  if (!settled && shown.every((engine) => statuses[engine.id] === null))
    return <MarketShelvesSkeleton label="Engines" />;
  const installed = shown.filter((engine) => statuses[engine.id]?.installed);
  const rest = shown.filter((engine) => !statuses[engine.id]?.installed);
  const render = (engine: CatalogEngine) => <EngineItem key={engine.id} engine={engine} />;
  return (
    <>
      {installed.length ? <Shelf title="On this computer">{installed.map(render)}</Shelf> : null}
      {rest.length ? (
        <MarketShelf key={query} title="More engines" items={rest} render={render} />
      ) : null}
    </>
  );
}

export function EngineTile({ engine }: { engine: CatalogEngine }) {
  return (
    <LogoTile size="tile">
      <Mark of={`engine:${engine.id}`} label={engine.name} size={40} aria-hidden />
    </LogoTile>
  );
}

function EngineItem({ engine }: { engine: CatalogEngine }) {
  const { status, signIn, loading, updating, refresh } = useCliVersionStatus(engine.id);
  const flow = useCliUpdateFlow(engine.id, { onSuccess: () => void listEngines() });
  const [signingIn, setSigningIn] = useState<{ provider?: string } | null>(null);
  const [open, setOpen] = useState(false);
  const installed = status?.installed === true;
  const busy =
    updating || loading || flow.state.status === "planning" || flow.state.status === "running";
  const canInstall =
    !installed &&
    engine.install.route !== "none" &&
    (status === null || status.updateKind !== null);
  const canSignIn = installed && signIn !== null && signIn.signedIn !== true && engine.id !== "dsh";
  const canUpdate = installed && hasCliUpdate(status);
  const updateLabel = `Update to ${status?.latestVersion ? versionText(status.latestVersion) : "latest"}`;

  let line = engine.maker ?? "";
  if (updating) line = installed ? "Updating" : "Installing";
  else if (installed) {
    const facts = [status?.localVersion ? versionText(status.localVersion) : "Installed"];
    if (signIn?.signedIn === true) facts.push("signed in");
    else if (signIn?.signedIn === false) facts.push("signed out");
    if (canUpdate && status?.latestVersion)
      facts.push(`${versionText(status.latestVersion)} available`);
    line = facts.join(", ");
  }

  const action = (filled: boolean): ReactNode => {
    if (canInstall)
      return (
        <Button
          variant={filled ? "get-filled" : "get"}
          size={filled ? undefined : "sm"}
          disabled={busy}
          onClick={() => void flow.begin()}
        >
          Install
        </Button>
      );
    if (canSignIn)
      return (
        <SignInButton
          engine={engine.id}
          size={filled ? undefined : "sm"}
          label={`Sign in to ${engine.name}`}
          disabled={updating}
          onSignIn={setSigningIn}
        />
      );
    return installed ? <CatalogDone /> : null;
  };

  const source = engine.source;
  const docs = isEngineId(engine.id) ? ENGINE_DOCS_URLS[engine.id] : undefined;
  const menu = (
    <>
      {canUpdate ? (
        <MenuItem
          icon={ArrowUp}
          label={updateLabel}
          disabled={busy}
          onSelect={() => void flow.begin()}
        />
      ) : null}
      {source ? (
        <MenuItem
          icon={ExternalLink}
          label="Open website"
          onSelect={() => void openExternalLink(source)}
        />
      ) : null}
      {docs ? (
        <MenuItem icon={BookOpen} label="Docs" onSelect={() => void openExternalLink(docs)} />
      ) : null}
      <MenuItem icon={RefreshCw} label="Check again" disabled={busy} onSelect={refresh} />
    </>
  );

  const facts = [
    ...(engine.maker ? [{ label: "Maker", value: engine.maker }] : []),
    { label: "Installs", value: installRouteText(engine.install.route) },
    ...(engine.source ? [{ label: "Source", value: sourceLabel(engine.source) }] : []),
    ...(installed && status?.localVersion
      ? [{ label: "Version", value: versionText(status.localVersion) }]
      : []),
  ];

  return (
    <>
      <ShelfItem
        logo={<EngineTile engine={engine} />}
        title={engine.name}
        line={line || undefined}
        action={action(false)}
        menu={menu}
        onOpen={() => setOpen(true)}
      />
      <StoreDetail
        open={open}
        onOpenChange={setOpen}
        logo={<EngineTile engine={engine} />}
        title={engine.name}
        line={line || undefined}
        action={action(true)}
        menu={menu}
        facts={facts}
      />
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
}
