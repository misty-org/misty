import { useEffect, useState } from "react";
import { apiBlobRequest } from "@/api/client";
import { publicBetaFeatureEnabled } from "@/features/launch";
import {
  memoryApi,
  PAUSED_UNTIL_RESUMED,
  recallSettings,
  useRecallStore,
  type MemoryStatus,
} from "@/features/recall";
import { Button } from "@/shared/ui";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { ChoiceControl, SwitchControl, TextAreaControl } from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";

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
  const available = publicBetaFeatureEnabled("recall");
  useEffect(() => {
    if (!available || !memory.enabled) return;
    void memoryApi.status().then(setStatus, () => setStatus(null));
  }, [available, memory.enabled]);
  if (!available)
    return (
      <SettingsSectionBlock
        title="Memory"
        description="Memory of what you read and say is being prepared for a future Misty release."
      >
        {null}
      </SettingsSectionBlock>
    );
  const paused = memory.pausedUntil > Date.now();
  const pause = paused ? (memory.pausedUntil >= PAUSED_UNTIL_RESUMED ? "resume" : "hour") : "off";
  const forget = async (what: Forget) => {
    if (confirming !== what) return setConfirming(what);
    setConfirming(null);
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const from = what === "hour" ? new Date(now.getTime() - 3_600_000) : midnight;
    try {
      const { forgotten } = await memoryApi.forget(
        what === "all" ? { all: true } : { from: from.toISOString(), to: now.toISOString() },
      );
      setResult(forgotten === 1 ? "Forgot 1 item." : `Forgot ${forgotten} items.`);
    } catch {
      setResult("That couldn't be forgotten. Try again.");
    }
  };
  const exportAll = async () => {
    try {
      const blob = await apiBlobRequest(memoryApi.exportPath);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `misty-memory-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      setResult("The export couldn't be made. Try again.");
    }
  };
  return (
    <>
      <SettingsSectionBlock
        title="Memory"
        description="Misty can remember the pages you read and what you dictate, so you and your agents can find them later. Only you can see your Memory."
      >
        <SettingsRow
          label="Remember pages I read"
          description="A page is kept after a few seconds in front. Private windows, sign-in, banking, health and email pages are never kept."
        >
          <SwitchControl
            checked={memory.enabled}
            disabled={props.working}
            onChange={(value) => set("enabled", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Pause"
          description="Stop remembering for a while without turning Memory off."
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
          description="Keep what you dictate, so you can find what you said."
          muted={!memory.enabled}
        >
          <SwitchControl
            checked={memory.rememberDictation}
            disabled={props.working || !memory.enabled}
            onChange={(value) => set("remember_dictation", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Sites Memory skips"
          description="One site per line, such as example.com. Its subdomains are skipped too."
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
      <SettingsSectionBlock
        title="Your Memory"
        description="Forgetting removes the pages and words, and what agents could find in them."
      >
        <SettingsRow
          label="Forget recent"
          description="Remove what Memory kept in the last hour or today."
        >
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
        <SettingsRow
          label="Export"
          description="Download everything Memory kept, as a zip with a page per day."
        >
          <Button size="sm" variant="ghost" onClick={() => void exportAll()}>
            Export
          </Button>
        </SettingsRow>
        {result && (
          <p role="status" className="px-1 text-xs text-cream-muted">
            {result}
          </p>
        )}
      </SettingsSectionBlock>
    </>
  );
}
