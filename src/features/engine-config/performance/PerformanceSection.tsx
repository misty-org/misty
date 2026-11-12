// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { Check, Copy, Download, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  DesktopSettingsNotice,
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "@/features/settings";
import { Button, CodeBlock, Skeleton } from "@/shared/ui";
import { SwitchControl } from "../../settings/SettingsControls";
import { exportPerformanceReport } from "./export";
import { appVersion, performanceApi } from "./nativeApi";
import {
  getPerformancePreference,
  setPerformanceEnabled,
  subscribePerformancePreference,
  synchronizePerformancePreference,
} from "./preference";
import { collectPerformanceReport } from "./report";
import { summarizePerformanceReport, type PerformanceReport } from "./summary";

const COPY_FEEDBACK_MS = 1500;

/**
 * Settings › Advanced › Performance: the last five minutes of Misty's CPU and memory, kept only in
 * memory and only on this computer. Copy a short summary after a slowdown, or save the whole
 * report as JSON. Only numbers and process roles are recorded: no chats, code, paths, arguments
 * or keys, and nothing is sent anywhere.
 */
export function PerformanceSection() {
  const enabled = useSyncExternalStore(subscribePerformancePreference, getPerformancePreference);
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [text, setText] = useState("");
  const [collecting, setCollecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const revision = useRef(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (getPerformancePreference() === null)
      void synchronizePerformancePreference().catch(() => {});
    return () => clearTimeout(resetTimer.current);
  }, []);

  const collect = useCallback(() => {
    const current = ++revision.current;
    setCollecting(true);
    setStatus(null);
    void collectPerformanceReport(() => performanceApi.report(), appVersion).then((next) => {
      if (current !== revision.current) return;
      setReport(next);
      setText(summarizePerformanceReport(next));
      setCollecting(false);
    });
  }, []);

  useEffect(() => {
    setReport(null);
    setText("");
    setCopied(false);
    if (enabled !== false) collect();
    else revision.current += 1;
  }, [enabled, collect]);

  const toggle = async (next: boolean) => {
    setSaving(true);
    setNotice(null);
    try {
      await setPerformanceEnabled(next);
    } catch {
      setNotice("The setting couldn't be saved, so nothing changed. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const exportFile = async () => {
    if (!report || exporting) return;
    setExporting(true);
    setNotice(null);
    try {
      const result = await exportPerformanceReport(report);
      if (result === "saved") setStatus("Report saved.");
    } catch {
      setNotice("The report couldn't be saved. Try again, or copy the summary instead.");
    } finally {
      setExporting(false);
    }
  };

  const copy = () => {
    if (!text) return;
    setNotice(null);
    clearTimeout(resetTimer.current);
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        resetTimer.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
      },
      () => setNotice("The summary couldn't be copied. Select the text and copy it yourself."),
    );
  };

  const partial = report !== null && report.native.status !== "available";

  return (
    <>
      {notice ? <DesktopSettingsNotice>{notice}</DesktopSettingsNotice> : null}
      <Section
        title="Performance"
        description="Numbers and process roles stay on this computer and clear when Misty quits. No chats, code, paths or keys are recorded."
      >
        <Row
          label="Record performance"
          description="Keeps the last five minutes. Turning it off stops recording and clears what was kept."
        >
          <SwitchControl
            checked={enabled === true}
            disabled={enabled === null || saving || exporting}
            onChange={(next) => void toggle(next)}
          />
        </Row>
        {enabled === false ? null : (
          <Row
            label="Report"
            description={
              partial
                ? "Misty's own process figures aren't available, so this has the window's figures only."
                : (status ??
                  "Process CPU counts one core as 100%; system CPU counts the whole computer as 100%.")
            }
            stacked
          >
            <div className="grid w-full gap-3">
              {report === null ? (
                <Skeleton className="h-52 w-full" aria-label="Report" />
              ) : (
                // Copying stays with the buttons under it, so the block draws no copy of its own.
                <CodeBlock
                  aria-label="Performance summary"
                  code={text}
                  copy={false}
                  className="max-h-52 overflow-y-auto"
                />
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button disabled={collecting} onClick={collect}>
                  <RefreshCw />
                  Refresh
                </Button>
                <Button disabled={!text} onClick={copy}>
                  {copied ? <Check /> : <Copy />}
                  {copied ? "Copied" : "Copy summary"}
                </Button>
                <Button disabled={!report || exporting || saving} onClick={() => void exportFile()}>
                  <Download />
                  Save full report
                </Button>
              </div>
            </div>
          </Row>
        )}
      </Section>
    </>
  );
}
