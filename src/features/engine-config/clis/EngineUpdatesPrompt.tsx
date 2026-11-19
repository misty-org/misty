/**
 * At launch, the installed engines that have a newer release, offered in one dialog: each with its
 * version now and the new one, then Update all or Later. Updates run the way Settings › Engines
 * runs them, one engine after another, inside the app. Later keeps it quiet for a while; Settings
 * still updates any engine on its own. It follows "Check for updates automatically".
 */
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { settingsBoolean, useSettingsStore } from "@/features/settings";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ListRow,
  Spinner,
  Text,
} from "@/shared/ui";
import { ENGINE_IDS, ENGINE_NAMES, type EngineId } from "../channels/engines";
import { EngineMark } from "../EngineMark";
import { cliApi, type CliVersionStatus } from "./api";

/** Wait after launch, so the check never competes with the window coming up. */
const startDelayMs = 15_000;
/** After a check (and after Later), no window checks again for this long. */
const quietMs = 6 * 60 * 60_000;
const checkedKey = "misty.engines.updatesChecked:v1";

/** Every window runs this, so the first one claims the check for all of them. */
function claimCheck(): boolean {
  try {
    const at = Number(localStorage.getItem(checkedKey) ?? 0);
    if (Date.now() - at < quietMs) return false;
    localStorage.setItem(checkedKey, String(Date.now()));
    return true;
  } catch {
    return true;
  }
}

type Outcome = "waiting" | "updating" | "done" | "failed";

export function EngineUpdatesPrompt({ accountScope }: { accountScope: string }) {
  const enabled = useSettingsStore((s) =>
    settingsBoolean(s.settings?.document ?? {}, "general", "auto_update_enabled", true),
  );
  const [behind, setBehind] = useState<CliVersionStatus[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!accountScope || !enabled || !hasTauriInternals()) return;
    let closed = false;
    const timer = setTimeout(() => {
      if (!claimCheck()) return;
      void Promise.all(ENGINE_IDS.map((engine) => cliApi.status(engine).catch(() => null))).then(
        (statuses) => {
          if (closed) return;
          setBehind(
            statuses.filter((status): status is CliVersionStatus =>
              Boolean(status?.installed && status.updateAvailable && status.updateKind),
            ),
          );
        },
      );
    }, startDelayMs);
    return () => {
      closed = true;
      clearTimeout(timer);
    };
  }, [accountScope, enabled]);

  async function updateAll() {
    setRunning(true);
    for (const { engine } of behind) {
      if (outcomes[engine] === "done") continue;
      setOutcomes((current) => ({ ...current, [engine]: "updating" }));
      try {
        await cliApi.update(engine, `startup-${engine}-${Date.now()}`);
        setOutcomes((current) => ({ ...current, [engine]: "done" }));
      } catch {
        setOutcomes((current) => ({ ...current, [engine]: "failed" }));
      }
    }
    setRunning(false);
  }

  if (behind.length === 0) return null;
  const finished = behind.every(({ engine }) => outcomes[engine] === "done");
  const failed = behind.some(({ engine }) => outcomes[engine] === "failed");
  const close = () => setBehind([]);
  return (
    <Dialog open onOpenChange={(open) => (open || running ? undefined : close())}>
      <DialogContent aria-describedby={undefined} size="md" layout="scroll" hideClose={running}>
        <DialogHeader>
          <DialogTitle>
            {behind.length === 1 ? "An engine update is available" : "Engine updates are available"}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          {behind.map((status) => {
            const engine = status.engine as EngineId;
            const outcome = outcomes[engine] ?? "waiting";
            return (
              <ListRow
                key={engine}
                leading={<EngineMark engine={engine} />}
                label={ENGINE_NAMES[engine] ?? engine}
                trailing={
                  outcome === "updating" ? (
                    <Spinner />
                  ) : outcome === "done" ? (
                    <Check />
                  ) : (
                    <Text tone={outcome === "failed" ? "danger" : "muted"}>
                      {outcome === "failed"
                        ? "Didn't update"
                        : `${status.localVersion ?? "?"} → ${status.latestVersion ?? "?"}`}
                    </Text>
                  )
                }
              />
            );
          })}
          {failed ? (
            <Text tone="muted">Settings › Engines shows what went wrong and can try again.</Text>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {finished ? (
            <Button variant="primary" autoFocus onClick={close}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="quiet" disabled={running} onClick={close}>
                Later
              </Button>
              <Button
                variant="primary"
                autoFocus
                disabled={running}
                onClick={() => void updateAll()}
              >
                Update all
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
