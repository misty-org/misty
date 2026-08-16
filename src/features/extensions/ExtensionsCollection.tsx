import { Button, CollectionItems, CollectionViewToggle } from "@/shared/ui";
import { DesktopSettingsRow, DesktopSettingsSection } from "@/features/settings";
import { SwitchControl } from "@/features/settings/SettingsControls";
import { AccountCollectionFilters } from "@/features/settings/AccountCollectionFilters";
import { ExtensionIcon } from "./ExtensionIcon";
import { ExtensionLoading } from "./ExtensionLoading";
import { extensionsNative } from "./native";
import { reportExtensionError, setPreference, useExtensionsStore } from "./store";
import type { CatalogEntry, CatalogPage, Installation, InstalledState } from "./types";

const installedFilters = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
  { value: "attention", label: "Needs attention" },
];
const catalogSorts = [
  { value: "recommended", label: "Discover" },
  { value: "users", label: "Popular" },
  { value: "updated", label: "Recently updated" },
];

function status(item: Installation, state?: InstalledState) {
  if (state?.status === "enabled") return "Enabled";
  if (!item.enabled) return "Disabled";
  return state?.status === "needs-review" ? "Needs review" : "Needs attention";
}

/** Installed extensions, or a page of the Firefox Add-ons catalog. */
export function ExtensionsCollection(props: {
  inInstalled: boolean;
  view: "grid" | "list";
  filter: string;
  sort: string;
  query: string;
  items: Array<Installation | CatalogEntry>;
  installed: Installation[];
  states: InstalledState[];
  catalog: CatalogPage | null;
  page: number;
  loading: boolean;
  busy: boolean;
  ready: boolean;
  runtimeReady: boolean;
  supported: boolean;
  agentAccess: boolean;
  onFilter(value: string): void;
  onSort(value: string): void;
  onPage(change: (page: number) => number): void;
  work(action: () => Promise<unknown>): Promise<void>;
  prepare(id: number): void;
  go(route: string): void;
}) {
  const { inInstalled, view, busy, installed, catalog, page, loading } = props;
  const isInstalled = (id: number) => installed.some((i) => i.id === id);
  return (
    <>
      <AccountCollectionFilters
        collectionId="extensions"
        options={inInstalled ? installedFilters : catalogSorts}
        value={inInstalled ? props.filter : props.sort}
        onChange={inInstalled ? props.onFilter : props.onSort}
        actions={
          <CollectionViewToggle
            value={view}
            onChange={(value) => void setPreference("view", value).catch(reportExtensionError)}
          />
        }
      />
      {inInstalled && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-cream-muted">
            Installs, controls, and extension-declared sync settings follow your account.
          </p>
          <Button
            variant="outline"
            disabled={busy || !props.supported}
            onClick={() =>
              void props.work(async () =>
                useExtensionsStore.setState({ states: await extensionsNative.updates() }),
              )
            }
          >
            {busy ? "Checking…" : "Check for updates"}
          </Button>
        </div>
      )}
      {!props.runtimeReady || (!inInstalled && loading) ? (
        <ExtensionLoading view={view} />
      ) : props.items.length ? (
        <CollectionItems
          columnSetId="extensions"
          view={view}
          gridLayout="compact"
          categoryLabel={inInstalled ? "Status" : "Source"}
          creatorLabel="Publisher"
          showLastActivity={false}
          fields={["Version"]}
          items={props.items.map((item) => {
            const state = props.states.find((s) => s.id === item.id);
            const catalogEntry = "authors" in item ? item : state?.review?.entry;
            return {
              id: String(item.id),
              title: item.name,
              icon: <ExtensionIcon entry={catalogEntry} />,
              category: "enabled" in item ? status(item, state) : "Firefox Add-ons",
              creator: catalogEntry?.authors.join(", "),
              updated: "",
              metadata: { Version: state?.version ?? catalogEntry?.version },
              onOpen: () => props.go(`/extensions/addon/${item.id}`),
              actions: (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || !props.supported || !props.ready}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (isInstalled(item.id)) props.go(`/extensions/addon/${item.id}`);
                    else void props.prepare(item.id);
                  }}
                >
                  {isInstalled(item.id) ? "Manage" : "Install"}
                </Button>
              ),
            };
          })}
        />
      ) : (
        <p className="py-8 text-sm text-cream-muted">
          {inInstalled
            ? props.query || props.filter !== "all"
              ? "No installed extensions match this view."
              : "No extensions installed. Discover extensions from Firefox Add-ons to get started."
            : "No extensions found. Try another search."}
        </p>
      )}
      {!inInstalled && catalog && (
        <div className="flex items-center justify-end gap-3">
          <Button
            variant="ghost"
            disabled={page === 1 || loading}
            onClick={() => props.onPage((v) => v - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-cream-muted">Page {page}</span>
          <Button
            variant="ghost"
            disabled={!catalog.hasMore || loading}
            onClick={() => props.onPage((v) => v + 1)}
          >
            Next
          </Button>
        </div>
      )}
      {inInstalled && (
        <DesktopSettingsSection title="Agent access">
          <DesktopSettingsRow
            label="Allow agents to use extensions"
            description="Individual extensions can also be turned off for agents."
          >
            <SwitchControl
              checked={props.agentAccess}
              disabled={!props.ready}
              onChange={(value) =>
                void setPreference("agent_access", value).catch(reportExtensionError)
              }
            />
          </DesktopSettingsRow>
        </DesktopSettingsSection>
      )}
    </>
  );
}
