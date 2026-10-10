import { useEffect, useState } from "react";
import { DesktopSettingsSection } from "@/features/settings/desktop";
import { accountLabels, AppLogo, appsApi, groupApps, type ConnectedApp } from "@/features/agents";
import { Checkbox, SkeletonList } from "@/shared/ui";

type AppsState = { available: boolean; apps: ConnectedApp[] };

// The settings row geometry: hairlines between rows, the control on the shared right edge.
const pickRowClass = [
  "grid min-h-16 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4",
  "border-t border-charcoal-border py-4 first:border-t-0",
].join(" ");

/**
 * Which of your connected accounts this Space uses: one row per account with a checkmark.
 * Accounts are connected once on the Integrations page; these picks are yours alone.
 */
export function SpaceSettingsApps({ spaceId, spaceName }: { spaceId: string; spaceName: string }) {
  const [state, setState] = useState<AppsState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const show = (result: AppsState) => live && setState(result);
    // The saved list paints at once; the fresh one follows.
    appsApi
      .list(show)
      .then(show)
      .catch(() => live && setError("Your apps couldn't be loaded. Try again in a moment."));
    return () => {
      live = false;
    };
  }, []);

  const picked = (item: ConnectedApp) => (item.spaces ?? []).some((space) => space.id === spaceId);
  async function toggle(item: ConnectedApp, on: boolean) {
    if (!state || saving) return;
    const previous = state;
    const thisSpace = { id: spaceId, name: spaceName, personal: false };
    const apps = state.apps.map((other) =>
      other.id !== item.id
        ? other
        : {
            ...other,
            spaces: on
              ? [...(other.spaces ?? []), thisSpace]
              : (other.spaces ?? []).filter((space) => space.id !== spaceId),
          },
    );
    setState({ ...state, apps });
    setSaving(true);
    setError("");
    try {
      await appsApi.setSpacePicks(
        spaceId,
        apps.filter(picked).map((other) => other.id),
      );
    } catch {
      setState(previous);
      setError("That change wasn't saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const description = `Agents you ask in ${spaceName} use only the accounts checked here. Only you see these choices, even in a shared Space.`;
  return (
    <DesktopSettingsSection title="Apps" description={description}>
      {error ? (
        <p role="alert" className="mb-2 text-[15px] leading-6 text-cream">
          {error}
        </p>
      ) : null}
      {state === null && !error ? (
        <SkeletonList label="Apps" rows={4} leading="tile" trailing rowClassName="min-h-16" />
      ) : null}
      {state && !state.available ? (
        <p className="text-[15px] leading-6 text-cream-muted">
          Connected apps are not set up on this Misty server.
        </p>
      ) : null}
      {state?.available && state.apps.length === 0 ? (
        <p className="text-[15px] leading-6 text-cream-muted">
          You haven't connected any apps yet. Connect them on the Integrations page, then choose
          here which ones this Space uses.
        </p>
      ) : null}
      {state?.available
        ? groupApps(state.apps.filter((item) => item.status !== "pending")).map((group) => {
            const labels = accountLabels(group.accounts);
            return group.accounts.map((item, index) => {
              const broken = item.status === "needs_attention";
              return (
                <label
                  key={item.id}
                  className={pickRowClass}
                >
                  <AppLogo app={group.app} size={20} />
                  <span className="grid min-w-0 gap-1">
                    <span className="truncate text-[15px] leading-6 text-cream">{group.name}</span>
                    <span className="truncate text-[15px] leading-6 text-cream-muted">
                      {broken ? `${labels[index]} · Needs attention` : labels[index]}
                    </span>
                  </span>
                  <Checkbox
                    aria-label={`Use ${group.name} (${labels[index]}) in ${spaceName}`}
                    checked={picked(item)}
                    disabled={saving || (broken && !picked(item))}
                    onCheckedChange={(next) => void toggle(item, next === true)}
                  />
                </label>
              );
            });
          })
        : null}
    </DesktopSettingsSection>
  );
}
