/**
 * Explore › Engines: every engine Misty's catalog knows (Claude Code, Codex and the rest), as a
 * store's shelves: the ones on this computer first, each with its sign-in as its CLI says, then the
 * rest with Install. It's how an engine is added after setup. Installing, updating and signing in
 * run the same flow as Settings › Agents › Setup (`engine-config/clis`); what an engine offers (its
 * models, modes, plugins, skills and connectors) stays the engine's own. Versions are checked as the
 * section opens, never on a timer.
 */
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
import { EngineMark } from "@/features/engine-config/EngineMark";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  Button,
  CatalogDone,
  EmptyState,
  LogoTile,
  MenuItem,
  Shelf,
  ShelfItem,
  StoreDetail,
} from "@misty/ui";
import { listEngines } from "../engines/enginesApi";
import {
  catalogEngineIds,
  catalogEngines,
  engineMatches,
  installRouteText,
  type CatalogEngine,
} from "./engineCatalog";
import { MarketShelf, MarketShelvesSkeleton } from "./MarketShelf";
import { sourceLabel } from "./PluginMaker";

const isEngineId = (id: string): id is EngineId => ENGINE_IDS.some((engine) => engine === id);

export function EnginesSection({ query }: { query: string }) {
  const { statuses, settled } = useCliStatuses(catalogEngineIds);
  const shown = catalogEngines.filter((engine) => engineMatches(engine, query));
  if (!shown.length) return <EmptyState inline title="No engines found" line="Try other words." />;
  // Until every engine has answered once, the shelves can't say which are installed.
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

/** An engine's mark at a shelf's tile size, standing bare as engine marks do. */
export function EngineTile({ engine }: { engine: CatalogEngine }) {
  return (
    <LogoTile size="tile">
      <EngineMark engine={engine.id} name={engine.name} size={40} />
    </LogoTile>
  );
}

function EngineItem({ engine }: { engine: CatalogEngine }) {
  const { status, signIn, loading, updating, refresh } = useCliVersionStatus(engine.id);
  // After an install every screen listing engines learns of it.
  const flow = useCliUpdateFlow(engine.id, { onSuccess: () => void listEngines() });
  const [signingIn, setSigningIn] = useState<{ provider?: string } | null>(null);
  const [open, setOpen] = useState(false);
  const installed = status?.installed === true;
  const busy =
    updating || loading || flow.state.status === "planning" || flow.state.status === "running";
  // Misty installs it only where the catalog has a route and its CLI check agrees.
  const canInstall =
    !installed &&
    engine.install.route !== "none" &&
    (status === null || status.updateKind !== null);
  // DeepSeek Harness keeps its providers in its own page (Settings › Agents › Channels).
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
