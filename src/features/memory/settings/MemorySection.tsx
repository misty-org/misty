import { useEffect, useState } from "react";
import { memoryApi, type MemoryStatus } from "../recall/api";
import { PAUSED_UNTIL_RESUMED, recallSettings } from "../recall/recallSettings";
import { useRecallStore } from "../recall/useRecallStore";
import { Button, ErrorNotification } from "@/shared/ui";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "@/features/settings";
import { ChoiceControl, SwitchControl, TextAreaControl } from "../../settings/SettingsControls";
import type { SettingsContentProps } from "../../settings/settingsTypes";

type Forget = "hour" | "today" | "all";

/** Settings › Memory: what Misty remembers of your browsing, and forgetting it. Device-only. */
export function MemorySection(props: SettingsContentProps) {
  const memory = recallSettings(props.document);
  const set = (key: string, value: string | boolean | number) =>
    props.onSettingChange("recall", key, value);
  const notice = useRecallStore((state) => state.notice);
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [confirming, setConfirming] = useState<Forget | null>(null);
  const [result, setResult] = useState("");
  const [failure, setFailure] = useState("");
  useEffect(() => {
    if (!memory.enabled) return;
    void memoryApi.status().then(setStatus, () => setStatus(null));
  }, [memory.enabled]);
  const paused = memory.pausedUntil > Date.now();
  const pause = paused ? (memory.pausedUntil >= PAUSED_UNTIL_RESUMED ? "resume" : "hour") : "off";
  const forget = async (what: Forget) => {
    if (confirming !== what) return setConfirming(what);
    setConfirming(null);
    setFailure("");
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const from = what === "hour" ? new Date(now.getTime() - 3_600_000) : midnight;
    try {
      const { forgotten } = await memoryApi.forget(
        what === "all" ? { all: true } : { from: from.toISOString(), to: now.toISOString() },
      );
      setResult(forgotten === 1 ? "Forgot 1 item." : `Forgot ${forgotten} items.`);
    } catch {
      setFailure("That couldn't be forgotten. Try again.");
    }
  };
  const exportAll = async () => {
    try {
      const blob = await memoryApi.exportZip();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `misty-memory-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      setFailure("The export couldn't be made. Try again.");
    }
  };
  return (
    <>
      <SettingsSectionBlock title="Remembering">
        <SettingsRow
          label="Remember pages I read"
          description="Never private, sign-in, banking, health or email pages."
        >
          <SwitchControl
            checked={memory.enabled}
            disabled={props.working}
            onChange={(value) => set("enabled", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Pause"

          muted={!memory.enabled}
        >
          <ChoiceControl
            value={pause}
            options={[
              { value: "off", label: "Off" },
              { value: "hour", label: "1 hour" },
              { value: "resume", label: "Until resumed" },
            ]}
            disabled={props.working || !memory.enabled}
            onValueChange={(value) =>
              set(
                "paused_until",
                value === "off"
                  ? 0
                  : value === "hour"
                    ? Date.now() + 3_600_000
                    : PAUSED_UNTIL_RESUMED,
              )
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Remember dictation"

          muted={!memory.enabled}
        >
          <SwitchControl
            checked={memory.rememberDictation}
            disabled={props.working || !memory.enabled}
            onChange={(value) => set("remember_dictation", value)}
          />
        </SettingsRow>
        <SettingsRow label="Morning brief" muted={!memory.enabled}>
          <SwitchControl
            checked={memory.morningBrief}
            disabled={props.working || !memory.enabled}
            onChange={(value) => set("morning_brief", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Sites Memory skips"
          description="One per line. Covers subdomains."
          stacked
        >
          <TextAreaControl
            value={memory.excludedSites.join("\n")}
            placeholder={"example.com\nintranet.example.org"}
            rows={4}
            disabled={props.working}
            onCommit={(value) => set("excluded_sites", value)}
          />
        </SettingsRow>
        {(notice || status?.message) && (
          <p role="status" className="px-1 text-xs text-cream-muted">
            {notice || status?.message}
          </p>
        )}
      </SettingsSectionBlock>
      <SettingsSectionBlock title="Data">
        <SettingsRow label="Forget recent">
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => void forget("hour")}>
              {confirming === "hour" ? "Forget the last hour?" : "Last hour"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void forget("today")}>
              {confirming === "today" ? "Forget today?" : "Today"}
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow
          label="Forget everything"
          description="Remove everything Memory has kept. This can't be undone."
        >
          <Button size="sm" variant="ghost" onClick={() => void forget("all")}>
            {confirming === "all" ? "Click again to forget everything" : "Forget everything"}
          </Button>
        </SettingsRow>
        <SettingsRow label="Export" description="A zip with a page per day.">
          <Button size="sm" variant="ghost" onClick={() => void exportAll()}>
            Export
          </Button>
        </SettingsRow>
        {result && (
          <p role="status" className="px-1 text-xs text-cream-muted">
            {result}
          </p>
        )}
        <ErrorNotification message={failure} onDismiss={() => setFailure("")} />
      </SettingsSectionBlock>
    </>
  );
}
