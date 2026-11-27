import { RefreshCw } from "lucide-react";
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
  notify,
  SettingsRow,
  SettingsSection,
  StoreInfo,
  StorePreviews,
  StoreSection,
  StoreSheet,
  StoreSheetSection,
  StoreSkeleton,
  StoreTile,
  StoreTiles,
  Text,
  useConfirmDelete,
} from "@misty/ui";
import { exploreApps, type ExploreCatalogApp, type ExploreInstalledApps } from "./explore_apps";
import { failureText, wordsMatch } from "./explore_index";
import { useExploreNav, type BarAction } from "./explore_view";
import { ActionButton, SeeAll } from "./ListingRows";

export const megabytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;

const downloadProgress = (apps: ExploreInstalledApps, app: ExploreCatalogApp) => {
  const download = apps.downloadOf(app.id);
  if (!download) return undefined;
  return { value: download.total ? download.received / download.total : 0 };
};

export function AppLogo({
  app,
  size = "card",
}: {
  app: ExploreCatalogApp;
  size?: "card" | "item" | "sheet";
}) {
  return (
    <AppLogoImage
      src={exploreApps().catalogLogoUrl(app)}
      name={app.name}
      size={size}
      render={app.icon_render}
    />
  );
}

function PermissionLines({
  apps,
  permissions,
}: {
  apps: ExploreInstalledApps;
  permissions: string[];
}) {
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

export function useAppAction(
  apps: ExploreInstalledApps,
  app: ExploreCatalogApp,
): { action: BarAction | null; dialog: ReactNode } {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const here = apps.versionOf(app.id);
  const approved = apps.approvedOf(app.id);
  const label = here === undefined ? "added" : "updated";
  const progress = downloadProgress(apps, app);
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
  const asks =
    here === undefined
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
  if (progress)
    return {
      action: {
        label: here === undefined ? "Get" : "Update",
        variant: "get",
        progress,
        onClick: get,
      },
      dialog,
    };
  if (here !== undefined && here !== app.version)
    return { action: { label: "Update", variant: "get", disabled: busy, onClick: get }, dialog };
  if (here !== undefined)
    return {
      action: { label: "Open", variant: "secondary", onClick: () => apps.open(app.id) },
      dialog,
    };
  return { action: { label: "Get", variant: "get", disabled: busy, onClick: get }, dialog };
}

export function AppItem({ apps, app }: { apps: ExploreInstalledApps; app: ExploreCatalogApp }) {
  const nav = useExploreNav();
  const { action, dialog } = useAppAction(apps, app);
  return (
    <>
      <StoreTile
        logo={<AppLogo app={app} />}
        title={app.name}
        line={app.description ?? `By ${app.maker}`}
        action={<ActionButton action={action} label={app.name} />}
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

export function AppsSection({
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
  if (!apps.loaded && !apps.error) return <StoreSkeleton label="Apps" look="tiles" items={4} />;
  if (!listed.length) return null;
  const shown = limit ? listed.slice(0, limit) : listed;
  return (
    <StoreSection
      title="Apps"
      action={onSeeAll && listed.length > shown.length ? <SeeAll onClick={onSeeAll} /> : undefined}
    >
      <StoreTiles label="Apps">
        {shown.map((app) => (
          <AppItem key={app.id} apps={apps} app={app} />
        ))}
      </StoreTiles>
    </StoreSection>
  );
}

export function AppsPage({ spaceId }: { spaceId: string }) {
  const apps = exploreApps().useExploreInstalledApps(spaceId);
  if (apps.loaded && !apps.listed.length)
    return <EmptyState inline title="No apps yet" line="Misty's registry lists none." />;
  return (
    <>
      <FeaturedApps spaceId={spaceId} />
      <AppsSection spaceId={spaceId} />
    </>
  );
}

export function AppSheet({
  spaceId,
  id,
  onClose,
}: {
  spaceId: string;
  id: string;
  onClose: () => void;
}) {
  const apps = exploreApps().useExploreInstalledApps(spaceId);
  const app = apps.listed.find((one) => one.id === id);
  if (!app) return null;
  return <AppSheetBody apps={apps} app={app} onClose={onClose} />;
}

function AppSheetBody({
  apps,
  app,
  onClose,
}: {
  apps: ExploreInstalledApps;
  app: ExploreCatalogApp;
  onClose: () => void;
}) {
  const { action, dialog } = useAppAction(apps, app);
  const { confirm, dialog: confirmDialog } = useConfirmDelete();
  const here = apps.versionOf(app.id);
  return (
    <StoreSheet
      open
      onOpenChange={(open) => !open && onClose()}
      logo={<AppLogo app={app} size="sheet" />}
      title={app.name}
      maker={app.maker}
      action={<ActionButton action={action} size="md" label={app.name} />}
      facts={[
        { label: "Version", value: here ?? app.version },
        { label: "Size", value: megabytes(app.size) },
        ...(app.license ? [{ label: "License", value: app.license }] : []),
        { label: "Source", value: app.upstream.includes("github.com") ? "GitHub" : app.upstream },
      ]}
    >
      {app.description ? (
        <Text as="p" size="body" wrap className="m-0">
          {app.description}
        </Text>
      ) : null}
      {app.screenshots?.length ? (
        <StorePreviews
          previews={app.screenshots.map((src, index) => ({
            src,
            alt: `${app.name}, picture ${index + 1}`,
          }))}
        />
      ) : null}
      {app.permissions.length ? (
        <StoreSheetSection title="What it can do">
          <PermissionLines apps={apps} permissions={app.permissions} />
        </StoreSheetSection>
      ) : null}
      {here !== undefined ? (
        <SettingsSection title="On this computer">
          <SettingsRow
            label={`Version ${here}`}
            description={here === app.version ? "Up to date" : `${app.version} is out`}
          />
        </SettingsSection>
      ) : null}
      <StoreSheetSection title="Information">
        <StoreInfo
          items={[
            { label: "Made by", value: app.maker },
            { label: "Source", value: app.upstream },
            ...(app.license ? [{ label: "License", value: app.license }] : []),
            { label: "Version", value: app.version },
          ]}
        />
      </StoreSheetSection>
      {here !== undefined ? (
        <div>
          <Button
            variant="danger"
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
        </div>
      ) : null}
      {dialog}
      {confirmDialog}
    </StoreSheet>
  );
}
