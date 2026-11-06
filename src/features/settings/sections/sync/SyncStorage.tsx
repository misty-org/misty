import { useEffect, useState } from "react";
import { formatBytes } from "@/shared/lib/fileFormat";
import { SkeletonList } from "@/shared/ui";
import { vaultNative, type UsagePart, type VaultUsage } from "@/features/vault";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "../../components/DesktopSettingsUI";

const kindNames: Record<string, string> = {
  tabs: "Open tabs",
  cookies: "Site sign-ins",
  local_storage: "Site data",
  page_state: "Page state",
  bookmarks: "Bookmarks",
  tab_groups: "Tab groups",
  history: "History",
  extension_sync: "Extension settings",
  passwords: "Passwords",
  autofill: "Addresses and cards",
  extensions: "Extensions",
  site_permissions: "Site permissions",
  search: "Search",
  downloads: "Downloads",
  profiles: "Profiles",
  clipboard: "Clipboard",
  other: "Other",
};

function Sizes(props: { parts: UsagePart[]; named?: (name: string) => string }) {
  return props.parts.map((part) => {
    const label = props.named ? props.named(part.name) : part.name || "All profiles";
    return (
      <Row key={part.name} label={label}>
        <span className="text-sm text-cream-muted">{formatBytes(part.bytes)}</span>
      </Row>
    );
  });
}

const kindName = (name: string) => kindNames[name] ?? kindNames.other;

/** A check normally takes moments. One still going after this long has stopped somewhere. */
const stuckAfterMs = 30_000;

function cookieCheckText(check: NonNullable<VaultUsage["cookieChecks"]>[number]["check"]) {
  if (!check) return "Not checked yet";
  if (check.readAt < check.beganAt && Date.now() - check.beganAt > stuckAfterMs)
    return "Couldn't finish checking";
  if (!check.readAt) return "Checking";
  const minutes = Math.floor((Date.now() - check.readAt) / 60_000);
  const when = minutes < 1 ? "just now" : `${minutes} min ago`;
  return `${check.cookies} cookies on ${check.sites} sites, checked ${when}`;
}

/**
 * What the vault holds and what this computer has moved. `version` refreshes it after a sync. Only
 * the server knows the sizes, so with no connection and nothing known yet, there's nothing to show.
 */
export function SyncStorage(props: { version: number | null; connected: boolean }) {
  const [usage, setUsage] = useState<VaultUsage | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    void vaultNative
      .usage()
      .then((next) => {
        if (!current) return;
        setUsage(next);
        setFailed(false);
      })
      .catch(() => (current ? setFailed(true) : undefined));
    return () => {
      current = false;
    };
  }, [props.version, props.connected]);

  if (!usage && failed) return null;
  if (!usage)
    return (
      <Section title="Storage">
        <SkeletonList label="Storage" rows={4} leading="none" trailing />
      </Section>
    );
  const used = formatBytes(usage.bytes);
  return (
    <>
      <Section title="Storage">
        <Row label="Storage used">
          <span className="text-sm text-cream-muted">
            {usage.limitBytes ? `${used} of ${formatBytes(usage.limitBytes)}` : used}
          </span>
        </Row>
        <Sizes parts={usage.byProfile} />
        <Sizes parts={usage.byKind} named={kindName} />
      </Section>
      <Section title="Data transferred in the last 30 days">
        <Row label="Sent">
          <span className="text-sm text-cream-muted">{formatBytes(usage.sentBytes)}</span>
        </Row>
        <Row label="Received">
          <span className="text-sm text-cream-muted">{formatBytes(usage.receivedBytes)}</span>
        </Row>
      </Section>
      {usage.cookieChecks?.length ? (
        <Section title="Site sign-ins on this computer">
          {usage.cookieChecks.map(({ profile, check }) => (
            <Row key={profile} label={profile}>
              <span className="text-sm text-cream-muted">{cookieCheckText(check)}</span>
            </Row>
          ))}
        </Section>
      ) : null}
      {usage.setAside.length || usage.siteSkips?.length ? (
        <Section title="Couldn't sync">
          {usage.siteSkips?.map((skip) => (
            <Row key={`${skip.site}:${skip.kind}`} label={skip.site} description={skip.reason}>
              {null}
            </Row>
          ))}
          {usage.setAside.map((part) => (
            <Row key={part.name} label={kindName(part.name)}>
              <span className="text-sm text-cream-muted">
                {part.bytes === 1 ? "1 item" : `${part.bytes.toLocaleString()} items`}
              </span>
            </Row>
          ))}
        </Section>
      ) : null}
    </>
  );
}
