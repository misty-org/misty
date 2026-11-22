import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AppLogoImage,
  Button,
  CatalogDone,
  EmptyState,
  ErrorState,
  FeatureCard,
  FeatureRow,
  MenuItem,
  Shelf,
  ShelfItem,
  ShelfSkeleton,
  StoreDetail,
  StoreDetailSection,
  Text,
} from "@misty/ui";
import { AddFromGitHubDialog } from "./AddFromGitHubDialog";
import { permissionLines } from "./appPermissions";
import { RemoveAppDialog } from "./RemoveAppDialog";
import { appRoute } from "./appRoutes";
import { catalogLogoUrl, useRegistryApps, type CatalogApp } from "./thirdPartyApps";
import { useSpaceApps } from "./useSpaceApps";

const matches = (query: string, ...texts: (string | undefined)[]) => {
  const words = query.trim().toLowerCase();
  return !words || texts.some((text) => text?.toLowerCase().includes(words));
};

const megabytes = (bytes: number) => (bytes / 1_000_000).toFixed(1);

/**
 * The apps of a Space: the open-source apps a mod can add, on one shelf. Picking one opens its
 * details, where Get shows what the app may do and adds it. The apps agents sign in to are
 * connectors, in Explore's Connectors.
 */
export function ExploreAppsSection({
  spaceId,
  canManage,
  query = "",
  limit,
  onSeeAll,
  featured = false,
}: {
  spaceId: string;
  canManage: boolean;
  query?: string;
  /** On All, each shelf shows this many, with See all opening the section. */
  limit?: number;
  /** On All: the shelves' See all, which opens the Apps section. */
  onSeeAll?: () => void;
  /** On All: the apps that export a banner, as featured cards above the shelves. */
  featured?: boolean;
}) {
  const navigate = useNavigate();
  const { apps, error, reload, install, remove } = useSpaceApps(spaceId);
  const listedApps = useRegistryApps();
  const [removing, setRemoving] = useState<CatalogApp | null>(null);
  const [picked, setPicked] = useState<CatalogApp | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");
  const [adding, setAdding] = useState(false);
  const installed = new Set((apps ?? []).map((app) => app.app_id));

  const get = async (app: CatalogApp) => {
    if (saving) return;
    setSaving(true);
    setFailure("");
    try {
      await install(app.id, app.version, app.permissions);
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : `${app.name} couldn't be added.`);
    } finally {
      setSaving(false);
    }
  };
  const open = (route: string) => {
    setPicked(null);
    navigate(route);
  };

  const listed = listedApps.filter((app) => matches(query, app.name, app.description, app.maker));
  const cut = <T,>(items: readonly T[]) => (limit ? items.slice(0, limit) : items);
  const seeAll = onSeeAll ? (
    <Button variant="quiet" size="sm" onClick={onSeeAll}>
      See all
    </Button>
  ) : canManage ? (
    // In the Apps section a mod can add any open-source app by its link, listed here or not.
    <Button variant="quiet" size="sm" onClick={() => setAdding(true)}>
      Add from GitHub
    </Button>
  ) : undefined;

  const appAction = (app: CatalogApp, size: "sm" | "lg" = "sm") =>
    installed.has(app.id) ? (
      size === "sm" ? (
        <CatalogDone label="In this Space" />
      ) : (
        <Button variant="primary" size="lg" onClick={() => open(appRoute(spaceId, app.id))}>
          Open
        </Button>
      )
    ) : canManage ? (
      size === "sm" ? (
        <Button variant="get" size="sm" onClick={() => setPicked(app)}>
          Get
        </Button>
      ) : (
        <Button variant="get-filled" size="lg" disabled={saving} onClick={() => void get(app)}>
          Get
        </Button>
      )
    ) : null;

  return (
    <>
      {featured && !query.trim() ? <FeaturedApps apps={listedApps} onOpen={setPicked} /> : null}
      {error ? (
        <ErrorState
          inline
          title="Apps couldn't load"
          line={error}
          action={{ label: "Try again", variant: "secondary", onClick: reload }}
        />
      ) : !apps ? (
        <ShelfSkeleton label="Open-source apps" />
      ) : listed.length ? (
        <Shelf title="Open-source apps" action={seeAll}>
          {cut(listed).map((app) => (
            <ShelfItem
              key={app.id}
              logo={<AppLogoImage src={catalogLogoUrl(app)} name={app.name} size="tile" />}
              title={app.name}
              line={app.description ?? `by ${app.maker}`}
              action={appAction(app)}
              menu={
                canManage && installed.has(app.id) ? (
                  <MenuItem
                    icon={Trash2}
                    label="Remove from this Space"
                    danger
                    onSelect={() => setRemoving(app)}
                  />
                ) : undefined
              }
              onOpen={() => setPicked(app)}
            />
          ))}
        </Shelf>
      ) : null}
      {query.trim() && !listed.length ? (
        <EmptyState inline title="No apps found" line="Try another word." />
      ) : null}

      {picked ? (
        <StoreDetail
          open
          onOpenChange={(next) => {
            if (!next) {
              setPicked(null);
              setFailure("");
            }
          }}
          banner={picked.banner}
          logo={<AppLogoImage src={catalogLogoUrl(picked)} name={picked.name} size="tile" />}
          title={picked.name}
          line={picked.description ?? `by ${picked.maker}`}
          action={appAction(picked, "lg")}
          menu={
            canManage && installed.has(picked.id) ? (
              <MenuItem
                icon={Trash2}
                label="Remove from this Space"
                danger
                onSelect={() => setRemoving(picked)}
              />
            ) : undefined
          }
          facts={[
            { label: "Maker", value: picked.maker },
            { label: "Version", value: picked.version },
            { label: "Size", value: megabytes(picked.size), detail: "MB" },
            { label: "License", value: "Open source", detail: picked.license },
          ]}
          previews={picked.screenshots?.map((src, index) => ({
            src,
            alt: `${picked.name}, picture ${index + 1}`,
          }))}
        >
          {failure ? (
            <Text as="p" tone="danger" wrap role="alert" className="m-0">
              {failure}
            </Text>
          ) : null}
          {picked.permissions.length ? (
            <StoreDetailSection title="What it can do">
              <ul className="m-0 grid list-none gap-1 p-0">
                {picked.permissions.map((permission) => (
                  <li key={permission}>
                    <Text tone="default" wrap>
                      {permissionLines[permission] ?? permission}
                    </Text>
                  </li>
                ))}
              </ul>
            </StoreDetailSection>
          ) : null}
        </StoreDetail>
      ) : null}
      {adding ? (
        <AddFromGitHubDialog
          onAdd={(source) =>
            install(source.entry.id, source.entry.version, source.entry.permissions, source)
          }
          onClose={() => setAdding(false)}
        />
      ) : null}
      {removing ? (
        <RemoveAppDialog
          appName={removing.name}
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          onRemove={async () => {
            await remove(removing.id);
            setRemoving(null);
            setPicked(null);
          }}
        />
      ) : null}
    </>
  );
}

/** Up to two apps that export a banner, as featured cards; none shows when no app has one. */
function FeaturedApps({
  apps,
  onOpen,
}: {
  apps: readonly CatalogApp[];
  onOpen: (app: CatalogApp) => void;
}) {
  const withBanner = apps.filter((app): app is CatalogApp & { banner: string } =>
    Boolean(app.banner),
  );
  if (!withBanner.length) return null;
  return (
    <FeatureRow>
      {withBanner.slice(0, 2).map((app) => (
        <FeatureCard
          key={app.id}
          banner={app.banner}
          eyebrow={`By ${app.maker}`}
          title={app.name}
          line={app.description}
          onOpen={() => onOpen(app)}
        />
      ))}
    </FeatureRow>
  );
}
