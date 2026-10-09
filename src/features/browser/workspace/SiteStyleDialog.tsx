import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { settingsString, useSettingsStore } from "@/features/settings";
import { parseSiteStyles, siteStyleHost, siteStylesWith } from "@/features/webviews/siteStyles";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Switch,
  Textarea,
} from "@/shared/ui";

const settingKey = "browser_site_styles_json";
const read = () =>
  settingsString(useSettingsStore.getState().settings?.document ?? {}, "general", settingKey, "[]");

/**
 * Customizes one site like Arc's Boosts: its own CSS, hidden elements picked
 * in the page, and a dark mode. Saved to the account, applied on every visit.
 */
export function SiteStyleDialog(props: {
  open: boolean;
  runtimeId: string;
  url: string;
  onClose(): void;
}) {
  const host = siteStyleHost(props.url);
  const [css, setCss] = useState("");
  const [dark, setDark] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (!props.open || !host) return;
    const current = parseSiteStyles(read()).find((entry) => entry.host === host);
    setCss(current?.css ?? "");
    setDark(current?.dark ?? false);
    setNotice(null);
  }, [props.open, host]);
  if (!host) return null;
  const save = (next: { css: string; dark: boolean }) =>
    useSettingsStore
      .getState()
      .updateSetting("general", settingKey, siteStylesWith(read(), host, next));
  const pick = async () => {
    // The page must be on screen to click, so the dialog steps aside meanwhile.
    setPicking(true);
    try {
      const selector = await invoke<string | null>("browser_webview_pick_element", {
        id: props.runtimeId,
      });
      if (selector) {
        const next = `${css.trim() ? `${css.trimEnd()}\n` : ""}${selector} { display: none !important; }`;
        setCss(next);
        save({ css: next, dark });
        setNotice("Hidden. Remove the line below to show it again.");
      }
    } catch (reason) {
      setNotice(String(reason));
    } finally {
      setPicking(false);
    }
  };
  return (
    <Dialog open={props.open && !picking} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Customize {host}</DialogTitle>
        <DialogDescription>
          Changes apply every time you visit this site, on each of your devices.
        </DialogDescription>
        <label className="mt-2 flex min-h-10 items-center justify-between gap-3 text-sm">
          <span>Dark mode for this site</span>
          <Switch
            checked={dark}
            onCheckedChange={(checked) => {
              setDark(checked);
              save({ css, dark: checked });
            }}
          />
        </label>
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">Custom CSS</span>
            <Button variant="outline" size="sm" onClick={() => void pick()}>
              Hide an element…
            </Button>
          </div>
          <Textarea
            aria-label="Custom CSS"
            rows={8}
            spellCheck={false}
            className="font-mono text-xs"
            placeholder="body { font-size: 18px; }"
            value={css}
            maxLength={32768}
            onChange={(event) => setCss(event.target.value)}
          />
          {notice ? <p className="text-sm text-cream-muted">{notice}</p> : null}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setCss("");
              setDark(false);
              save({ css: "", dark: false });
            }}
          >
            Reset site
          </Button>
          <Button
            onClick={() => {
              save({ css, dark });
              props.onClose();
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
