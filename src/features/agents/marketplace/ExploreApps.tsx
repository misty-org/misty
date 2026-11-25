import { RefreshCw, Settings2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  AppLogoImage,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  FeatureCard,
  FeatureRow,
  MenuItem,
  notify,
  ProductInfo,
  ProductPage,
  ProductPreviews,
  ProductSection,
  SettingsRow,
  SettingsSection,
  Shelf,
  ShelfItem,
  ShelfSkeleton,
  Text,
  useConfirmDelete,
} from "@misty/ui";
import { exploreApps, type ExploreCatalogApp, type ExploreInstalledApps } from "./explore_apps";
import { failureText, wordsMatch } from "./explore_index";
import { progressLine } from "./ExploreSpeechParts";
import { useBarAction, useExploreNav, type BarAction } from "./explore_view";
import { ActionButton, SeeAll } from "./ListingRows";

const megabytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;

const downloadLine = (apps: ExploreInstalledApps, app: ExploreCatalogApp) => {
  const download = apps.downloadOf(app.id);
  return download ? progressLine({ ...download, phase: "downloading" }) : undefined;
};

function AppLogo({ app, size = "tile" }: { app: ExploreCatalogApp; size?: "tile" | "hero" }) {
  return (
    <AppLogoImage
      src={exploreApps().catalogLogoUrl(app)}
      name={app.name}
      size={size}
      render={app.icon_render}
    />
  );
}

function PermissionLines({ apps, permissions }: { apps: ExploreInstalledApps; permissions: string[] }) {
  return (
    <ul className="m-0 grid list-none gap-1 p-0">
      {permissions.map((permission) => (
        <li key={permission}>
          <Text size="body" wrap>
            {apps.permissionLine(permission)}
          </Text>
        </li>
      ))}
    </ul>
  );
}

function ApproveAppDialog({
  apps,
  app,
  open,
  onOpenChange,
  onAllow,
}: {
  apps: ExploreInstalledApps;
  app: ExploreCatalogApp;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAllow: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{`What ${app.name} can do`}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <PermissionLines apps={apps} permissions={app.permissions} />
        </DialogBody>
        <DialogFooter>
          <Button variant="quiet" size="lg" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              onOpenChange(false);
              onAllow();
            }}
          >
            Allow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useAppAction(
  apps: ExploreInstalledApps,
  app: ExploreCatalogApp,
  onPage: boolean,
): { action: BarAction | null; dialog: ReactNode } {
  const nav = useExploreNav();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const here = apps.versionOf(app.id);
  const approved = apps.approvedOf(app.id);
  const label = here === undefined ? "added" : "updated";
  const install = async () => {
    setBusy(true);
    try {
      await apps.install(app.id, app.version, app.permissions);
    } catch (reason) {
      notify({ message: failureText(reason, `${app.name} couldn't be ${label}.`), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const asks = here === undefined
    ? app.permissions
    : app.permissions.filter((permission) => !approved.includes(permission));
  const get = () => {
    if (asks.length) setAsking(true);
    else void install();
  };
  const dialog = (
    <ApproveAppDialog
      apps={apps}
      app={app}
      open={asking}
      onOpenChange={setAsking}
      onAllow={() => void install()}
    />
  );
  if (here !== undefined && here !== app.version)
    return { action: { label: "Update", variant: "get", disabled: busy, onClick: get }, dialog };
  if (here !== undefined)
    return {
      action: { label: "Open", variant: "secondary", onClick: () => apps.open(app.id) },
      dialog,
    };
  if (!onPage)
    return {
      action: { label: "Get", variant: "get", onClick: () => nav.open({ kind: "apps", id: app.id }) },
      dialog,
    };
  return { action: { label: "Get", variant: "get", disabled: busy, onClick: get }, dialog };
}

function AppItem({ apps, app }: { apps: ExploreInstalledApps; app: ExploreCatalogApp }) {
  const nav = useExploreNav();
  const { action, dialog } = useAppAction(apps, app, false);
  return (
    <>
      <ShelfItem
        logo={<AppLogo app={app} />}
        title={app.name}
        line={downloadLine(apps, app) ?? app.description ?? `By ${app.maker}`}
        action={<ActionButton action={action} />}
        onOpen={() => nav.open({ kind: "apps", id: app.id })}
      />
      {dialog}
    </>
  );
}

export function FeaturedApps({ spaceId }: { spaceId: string }) {
  const nav = useExploreNav();
  const apps = exploreApps().useExploreInstalledApps(spaceId);
  const picks = apps.listed.filter((app): app is ExploreCatalogApp & { banner: string } =>
    Boolean(app.banner),
  );
  if (!picks.length) return null;
  return (
    <FeatureRow>
      {picks.slice(0, 2).map((app) => (
        <FeatureCard
          key={app.id}
          banner={app.banner}
          eyebrow={`By ${app.maker}`}
          title={app.name}
          line={app.description}
          onOpen={() => nav.open({ kind: "apps", id: app.id })}
        />
      ))}
    </FeatureRow>
  );
}

export function AppsShelf({
  spaceId,
  query = "",
  limit,
  onSeeAll,
  quiet = false,
}: {
  spaceId: string;
  query?: string;
  limit?: number;
  onSeeAll?: () => void;
  quiet?: boolean;
}) {
  const apps = exploreApps().useExploreInstalledApps(spaceId);
  const listed = apps.listed.filter((app) =>
    wordsMatch(query, app.name, app.description, app.maker),
  );
  if (apps.error && !quiet)
    return (
      <ErrorState
        inline
        title="Apps couldn't load"
        line={apps.error}
        action={{ label: "Try again", icon: RefreshCw, variant: "secondary", onClick: apps.reload }}
      />
    );
  if (!apps.loaded && !apps.error) return <ShelfSkeleton label="Apps" />;
  if (!listed.length) return null;
  const shown = limit ? listed.slice(0, limit) : listed;
  return (
    <Shelf
      title="Apps"
      action={onSeeAll && listed.length > shown.length ? <SeeAll onClick={onSeeAll} /> : undefined}
    >
      {shown.map((app) => (
        <AppItem key={app.id} apps={apps} app={app} />
      ))}
    </Shelf>
  );
}

export function AppsPage({ spaceId }: { spaceId: string }) {
  const apps = exploreApps().useExploreInstalledApps(spaceId);
  if (apps.loaded && !apps.listed.length)
    return <EmptyState inline title="No apps yet" line="Misty's registry lists none." />;
  return (
    <>
      <FeaturedApps spaceId={spaceId} />
      <AppsShelf spaceId={spaceId} />
    </>
  );
}

export function AppProduct({ spaceId, id }: { spaceId: string; id: string }) {
  const apps = exploreApps().useExploreInstalledApps(spaceId);
  const app = apps.listed.find((one) => one.id === id);
  if (!app)
    return (
      <EmptyState
        inline
        title="This app isn't listed any more"
        line="Misty's registry no longer has it."
      />
    );
  return <AppProductPage apps={apps} app={app} />;
}

function AppProductPage({ apps, app }: { apps: ExploreInstalledApps; app: ExploreCatalogApp }) {
  const nav = useExploreNav();
  const { action, dialog } = useAppAction(apps, app, true);
  useBarAction(action, app.name);
  const site = apps.isSite(app);
  const here = apps.versionOf(app.id);
  return (
    <ProductPage
      logo={<AppLogo app={app} size="hero" />}
      title={app.name}
      line={downloadLine(apps, app) ?? app.description}
      maker={app.maker}
      action={<ActionButton action={action} size="md" />}
      menu={
        here !== undefined ? (
          <MenuItem
            icon={Settings2}
            label="Manage"
            onSelect={() => nav.manage({ kind: "apps", id: app.id })}
          />
        ) : undefined
      }
      onHeroOut={nav.setPinned}
      facts={[
        { label: "Made by", value: app.maker },
        { label: "Kind", value: site ? "Website" : "Web app" },
        ...(site
          ? [{ label: "Website", value: apps.siteHost(app) }]
          : [
              { label: "Version", value: app.version },
              { label: "Size", value: megabytes(app.size) },
            ]),
        ...(app.permissions.includes("files")
          ? [{ label: "Works with", value: "Files", detail: "In the Space you open it in" }]
          : []),
      ]}
    >
      {app.screenshots?.length ? (
        <ProductSection title="Preview">
          <ProductPreviews
            previews={app.screenshots.map((src, index) => ({
              src,
              alt: `${app.name}, picture ${index + 1}`,
            }))}
          />
        </ProductSection>
      ) : null}
      {app.permissions.length ? (
        <ProductSection title="What it can do">
          <PermissionLines apps={apps} permissions={app.permissions} />
        </ProductSection>
      ) : null}
      <ProductSection title="Information">
        <ProductInfo
          items={[
            { label: "Made by", value: app.maker },
            ...(site ? [] : [{ label: "Source", value: app.upstream }]),
            ...(app.license ? [{ label: "License", value: app.license }] : []),
            ...(site ? [] : [{ label: "Version", value: app.version }]),
          ]}
        />
      </ProductSection>
      {dialog}
    </ProductPage>
  );
}

export function AppManage({ spaceId, id }: { spaceId: string; id: string }) {
  const apps = exploreApps().useExploreInstalledApps(spaceId);
  const app = apps.listed.find((one) => one.id === id);
  if (!app) return null;
  return <AppManageRows apps={apps} app={app} />;
}

function AppManageRows({ apps, app }: { apps: ExploreInstalledApps; app: ExploreCatalogApp }) {
  const { confirm, dialog } = useConfirmDelete();
  const { action, dialog: approve } = useAppAction(apps, app, true);
  const here = apps.versionOf(app.id);
  if (here === undefined) return null;
  return (
    <SettingsSection title={app.name}>
      <SettingsRow label="On this computer" description="It opens in the Space the window shows">
        <Button size="sm" onClick={() => apps.open(app.id)}>
          Open
        </Button>
      </SettingsRow>
      <SettingsRow
        label={`Version ${here}`}
        description={here === app.version ? "Up to date" : `${app.version} is out`}
      >
        {here !== app.version ? (
          <Button variant="get" size="sm" onClick={() => action?.onClick()}>
            Update
          </Button>
        ) : null}
      </SettingsRow>
      <SettingsRow label="Remove from this computer">
        <Button
          variant="danger"
          size="sm"
          onClick={() =>
            void confirm({
              title: `Remove ${app.name}?`,
              what: `${app.name} is removed from this computer. What it saved stays in each Space's Files.`,
              confirmLabel: "Remove",
              onConfirm: async () => {
                await apps.remove(app.id);
              },
            })
          }
        >
          Remove
        </Button>
      </SettingsRow>
      {dialog}
      {approve}
    </SettingsSection>
  );
}
