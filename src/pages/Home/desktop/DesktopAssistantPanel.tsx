import { useEffect } from "react";
import { Bot } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import mikaAnimation from "../../../assets/bots/cloud-folder/mika.webp";
import { openCloudFolderBotWindow } from "../../../bots/cloudFolderBot";
import { useAppStore } from "../../../stores/useAppStore";
import { assistantDailyMessageLimit, useAssistantUsageStore } from "../../../stores/useAssistantUsageStore";
import { selectAssistantPreferences, useSettingsStore } from "../../../stores/useSettingsStore";

const panelClass =
  "flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-3 shadow-xl shadow-black/20";
const headerClass =
  "mb-2 flex shrink-0 items-center gap-2 border-b border-white/[0.06] pb-2 text-sm font-semibold text-text";

export function DesktopAssistantPanel() {
  const assetsDir = useAppStore((state) => state.app?.environment.assetsDir);
  const { enabled, filesAllowed, cleanupAllowed, searchAllowed } = useSettingsStore(
    useShallow((state) => {
      const preferences = selectAssistantPreferences(state.settings?.document);
      return {
        enabled: preferences.enabled,
        filesAllowed: preferences.scopes.filesAllowed,
        cleanupAllowed: preferences.scopes.cleanupAllowed,
        searchAllowed: preferences.scopes.searchAllowed,
      };
    }),
  );
  const { messagesUsedToday, syncForToday } = useAssistantUsageStore(
    useShallow((state) => ({
      messagesUsedToday: state.messagesUsedToday,
      syncForToday: state.syncForToday,
    })),
  );
  const enabledScopes = [
    filesAllowed ? "Files" : null,
    cleanupAllowed ? "Cleanup" : null,
    searchAllowed ? "Search" : null,
  ].filter((scope): scope is string => scope !== null);

  useEffect(() => {
    syncForToday();
    const interval = window.setInterval(syncForToday, 60_000);
    return () => window.clearInterval(interval);
  }, [syncForToday]);

  return (
    <section className={panelClass} aria-label="Assistant">
      <div className={headerClass}>
        <Bot className="h-4 w-4 shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate">Assistant</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[78px_minmax(0,1fr)] items-center gap-3">
        <button
          aria-label="Show Mika"
          className="grid h-[78px] w-[78px] place-items-center rounded-xl border-0 bg-transparent p-0 outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!enabled}
          onClick={() => void openCloudFolderBotWindow(assetsDir)}
          title={enabled ? "Show Mika" : "Enable Mika in Settings first"}
          type="button"
        >
          <img
            alt=""
            className="h-[58px] w-[70px] object-contain"
            draggable={false}
            src={mikaAnimation}
          />
        </button>

        <div className="grid min-w-0 gap-2">
          <div className="flex min-w-0 items-center justify-between gap-3 text-xs">
            <span className="truncate font-semibold text-text">Daily usage</span>
            <span className="shrink-0 tabular-nums text-text-muted">{messagesUsedToday} / {assistantDailyMessageLimit}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden="true">
            <span
              className="block h-full rounded-full bg-cyan-300/70 transition-[width] duration-300"
              style={{ width: `${Math.min(100, (messagesUsedToday / assistantDailyMessageLimit) * 100)}%` }}
            />
          </div>
          <div className="flex min-h-5 flex-wrap gap-1">
            {enabledScopes.length > 0 ? enabledScopes.map((scope) => (
              <span className="rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold text-text-muted" key={scope}>
                {scope}
              </span>
            )) : (
              <span className="text-[10px] leading-5 text-text-muted">Allow scopes in Settings</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
