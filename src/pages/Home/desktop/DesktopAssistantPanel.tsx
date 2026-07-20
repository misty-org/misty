import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { openCloudFolderBotWindow } from "@/bots/cloudFolderBot";
import { runtimeAssetSource } from "@/shared/assets/runtimeAsset";
import { useAppStore } from "../../../stores/useAppStore";
import {
  assistantDailyMessageLimit,
  useAssistantUsageStore,
} from "../../../stores/useAssistantUsageStore";
import { selectAssistantPreferences, useSettingsStore } from "../../../stores/useSettingsStore";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Progress } from "../../../components/ui/progress";

const panelClass = "flex min-h-0 min-w-0 flex-col";
const headerClass = "mb-2 flex shrink-0 items-center gap-2 text-sm font-medium text-foreground";

export function DesktopAssistantPanel() {
  const assetsDir = useAppStore((state) => state.app?.environment.assetsDir);
  const mikaAnimationSource = runtimeAssetSource(assetsDir, "animations/mika.webp");
  const [mikaImageUnavailable, setMikaImageUnavailable] = useState(false);
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

  useEffect(() => {
    setMikaImageUnavailable(false);
  }, [mikaAnimationSource]);

  return (
    <section className={panelClass} aria-label="Assistant">
      <div className={headerClass}>
        <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate">Assistant</h2>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[78px_minmax(0,1fr)] items-center gap-3">
        <Button
          aria-label="Show Mika"
          className="size-[72px] rounded-lg bg-muted/25 p-0 hover:bg-muted/50"
          disabled={!enabled}
          onClick={() => void openCloudFolderBotWindow(assetsDir)}
          title={enabled ? "Show Mika" : "Enable Mika in Settings first"}
          type="button"
          variant="ghost"
        >
          {mikaAnimationSource && !mikaImageUnavailable ? (
            <img
              alt=""
              className="h-14 w-16 object-contain"
              draggable={false}
              src={mikaAnimationSource}
              onError={() => setMikaImageUnavailable(true)}
            />
          ) : (
            <Bot aria-hidden="true" className="size-6 text-muted-foreground" />
          )}
        </Button>

        <div className="grid min-w-0 gap-2">
          <div className="flex min-w-0 items-center justify-between gap-3 text-xs">
            <span className="truncate font-medium text-foreground">Daily usage</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {messagesUsedToday} / {assistantDailyMessageLimit}
            </span>
          </div>
          <Progress
            aria-label="Mika daily message usage"
            aria-valuetext={`${messagesUsedToday} of ${assistantDailyMessageLimit} messages used`}
            className="h-1.5"
            value={Math.min(100, (messagesUsedToday / assistantDailyMessageLimit) * 100)}
          />
          <div className="flex min-h-5 flex-wrap gap-1">
            {enabledScopes.length > 0 ? (
              enabledScopes.map((scope) => (
                <Badge className="text-[10px]" key={scope} variant="secondary">
                  {scope}
                </Badge>
              ))
            ) : (
              <span className="text-[10px] leading-5 text-muted-foreground">
                {enabled ? "Allow scopes in Settings" : "Enable Mika in Settings"}
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
