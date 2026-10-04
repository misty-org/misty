import { Button } from "@/shared/ui";
import { DesktopSettingsRow, DesktopSettingsSection } from "@/features/settings";
import { SwitchControl } from "@/features/settings/SettingsControls";
import { ExtensionIcon, plainDescription } from "./ExtensionIcon";
import { ExtensionLoading } from "./ExtensionLoading";
import { extensionsNative } from "./native";
import { pinIds, togglePin, updateInstallation } from "./store";
import type { CatalogEntry, Installation, InstalledState } from "./types";

type Work = (action: () => Promise<unknown>) => Promise<void>;

/** One extension's page: what it is, and its controls once installed. */
export function ExtensionDetail({
  detail,
  pending,
  selected,
  local,
  busy,
  ready,
  supported,
  work,
  prepare,
  onUninstall,
}: {
  detail?: CatalogEntry;
  /** The catalog entry or extension runtime is still loading. */
  pending: boolean;
  selected?: Installation;
  local?: InstalledState;
  busy: boolean;
  ready: boolean;
  supported: boolean;
  work: Work;
  prepare(id: number): void;
  onUninstall(installation: Installation): void;
}) {
  if (pending && !detail)
    return (
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <ExtensionLoading view="detail" />
      </div>
    );
  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      {detail && (
        <>
          <header className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center [&_img]:size-8 [&_svg]:!size-8">
                <ExtensionIcon entry={detail} />
              </span>
              <h1 className="min-w-0 break-words text-xl font-medium text-cream-bright">
                {detail.name}
              </h1>
            </div>
            <p className="text-sm leading-relaxed text-cream-muted">
              {plainDescription(detail.summary)}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1 text-sm">
                <span className="break-words">
                  By {detail.authors.join(", ") || "Unknown publisher"}
                </span>
                <span className="text-xs text-cream-muted">
                  Version {local?.version ?? detail.version} · Firefox Add-ons
                </span>
              </div>
              <Button
                disabled={busy || !ready || !supported}
                onClick={() => (selected ? onUninstall(selected) : void prepare(detail.id))}
              >
                {busy ? "Working…" : selected ? "Uninstall" : "Install"}
              </Button>
            </div>
          </header>
          <p className="border-t border-charcoal-border pt-6 whitespace-pre-wrap break-words text-sm leading-relaxed text-cream-muted">
            {plainDescription(detail.description)}
          </p>
          {selected && (
            <ExtensionControls selected={selected} local={local} busy={busy} work={work} />
          )}
          {selected && (
            <GrantedAccess selected={selected} busy={busy} work={work} prepare={prepare} />
          )}
          {local?.review?.findings.map((finding) => (
            <p key={finding} className="text-sm text-cream-muted">
              {finding}
            </p>
          ))}
        </>
      )}
    </div>
  );
}

function ExtensionControls({
  selected,
  local,
  busy,
  work,
}: {
  selected: Installation;
  local?: InstalledState;
  busy: boolean;
  work: Work;
}) {
  return (
    <DesktopSettingsSection title="Extension controls">
      <DesktopSettingsRow
        label="Enabled"
        description={
          local?.detail ??
          (local?.status === "enabled"
            ? "Running on this device."
            : "Runtime status is shown after loading.")
        }
      >
        <SwitchControl
          checked={selected.enabled}
          disabled={busy}
          onChange={(value) => void work(() => updateInstallation(selected.id, { enabled: value }))}
        />
      </DesktopSettingsRow>
      <DesktopSettingsRow
        label="Allow private tabs"
        description="The extension can access permitted sites in private tabs."
      >
        <SwitchControl
          checked={selected.privateAccess}
          disabled={busy || local?.review?.privateAllowed === false}
          onChange={(value) =>
            void work(() => updateInstallation(selected.id, { privateAccess: value }))
          }
        />
      </DesktopSettingsRow>
      <DesktopSettingsRow
        label="Allow agent access"
        description="Agents can use this extension within their existing browser access."
      >
        <SwitchControl
          checked={selected.agentAccess}
          disabled={busy}
          onChange={(value) =>
            void work(() => updateInstallation(selected.id, { agentAccess: value }))
          }
        />
      </DesktopSettingsRow>
      <DesktopSettingsRow label="Pin to toolbar">
        <SwitchControl
          checked={pinIds().includes(selected.id)}
          disabled={busy}
          onChange={() => void work(() => togglePin(selected.id))}
        />
      </DesktopSettingsRow>
      {local?.review?.hasOptions && (
        <DesktopSettingsRow label="Extension settings">
          <Button
            variant="outline"
            onClick={() => void work(() => extensionsNative.options(selected.id))}
          >
            Open settings
          </Button>
        </DesktopSettingsRow>
      )}
    </DesktopSettingsSection>
  );
}

function GrantedAccess({
  selected,
  busy,
  work,
  prepare,
}: {
  selected: Installation;
  busy: boolean;
  work: Work;
  prepare(id: number): void;
}) {
  return (
    <DesktopSettingsSection
      title="Granted access"
      description="Removing a permission may disable functionality. Review the extension again to restore its requested access."
    >
      {[...selected.permissions, ...selected.hosts].map((permission) => (
        <DesktopSettingsRow key={permission} label={permission}>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void work(() =>
                updateInstallation(selected.id, {
                  permissions: selected.permissions.filter((p) => p !== permission),
                  hosts: selected.hosts.filter((p) => p !== permission),
                }),
              )
            }
          >
            Remove access
          </Button>
        </DesktopSettingsRow>
      ))}
      <DesktopSettingsRow label="Review requested permissions">
        <Button variant="outline" disabled={busy} onClick={() => void prepare(selected.id)}>
          Review
        </Button>
      </DesktopSettingsRow>
    </DesktopSettingsSection>
  );
}
