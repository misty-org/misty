import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui";
import { useBrowserDownloadsStore } from "../library/downloadsStore";
import { browserLibrary, type BrowserWebsiteDataKind } from "../library/native";
import { useBrowserRuntimeStore } from "./browserRuntime";
import { useBrowserOverlayControl } from "./useBrowserOverlayControl";

const ranges = [
  { label: "Last hour", ms: 3_600_000 },
  { label: "Last 24 hours", ms: 86_400_000 },
  { label: "Last 7 days", ms: 7 * 86_400_000 },
  { label: "All time", ms: Number.POSITIVE_INFINITY },
];

type Choice = "history" | "downloads" | BrowserWebsiteDataKind;

const choices: { id: Choice; label: string; detail: string }[] = [
  { id: "history", label: "Browsing history", detail: "Pages you visited, and their address bar suggestions." },
  { id: "downloads", label: "Download list", detail: "Downloaded files stay on disk." },
  { id: "cookies", label: "Cookies and site data", detail: "Signs you out of most websites." },
  { id: "cache", label: "Cached images and files", detail: "Some sites may load more slowly next time." },
];

/** Clear browsing data for this tab's browser profile. */
export function BrowserClearDataDialog(props: {
  request: number;
  tabId: string;
  profileId?: string;
  suspensionReason: string;
}) {
  const overlay = useBrowserOverlayControl(props.suspensionReason);
  const [range, setRange] = useState(1);
  const [selected, setSelected] = useState<Set<Choice>>(new Set(["history", "cache"]));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.request) return;
    setError(null);
    overlay.onOpenChange(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.request]);

  const clear = async () => {
    const span = ranges[range].ms;
    const since = Number.isFinite(span) ? Date.now() - span : 0;
    setWorking(true);
    setError(null);
    try {
      if (selected.has("history"))
        await browserLibrary.clearHistory({ profileId: props.profileId, since });
      if (selected.has("downloads")) {
        await browserLibrary.removeDownloads({ since });
        await useBrowserDownloadsStore.getState().refresh();
      }
      const kinds = (["cookies", "cache"] as const).filter((kind) => selected.has(kind));
      if (kinds.length)
        await browserLibrary.clearWebsiteData({ profileId: props.profileId, kinds, since });
      overlay.onOpenChange(false);
      useBrowserRuntimeStore.getState().setNotice(props.tabId, "Browsing data cleared.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={overlay.open} onOpenChange={overlay.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Clear browsing data</DialogTitle>
        <DialogDescription>Applies to this browser profile on this device.</DialogDescription>
        <Field label="Time range">
          <Select value={String(range)} onValueChange={(value) => setRange(Number(value))}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ranges.map((item, index) => (
                <SelectItem key={item.label} value={String(index)}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid gap-3">
          {choices.map((choice) => (
            <label key={choice.id} className="flex items-start gap-3 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={selected.has(choice.id)}
                onCheckedChange={(checked) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (checked === true) next.add(choice.id);
                    else next.delete(choice.id);
                    return next;
                  })
                }
              />
              <span>
                <span className="block text-cream-bright">{choice.label}</span>
                <span className="block text-xs text-cream-muted">{choice.detail}</span>
              </span>
            </label>
          ))}
        </div>
        {selected.has("cookies") ? (
          <p className="rounded-md bg-charcoal-card px-3 py-2 text-xs text-cream-muted">
            If Sync is on, website sign-ins saved from another device can be restored the next
            time this device syncs.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => overlay.onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={working || !selected.size} onClick={() => void clear()}>
            {working ? "Clearing…" : "Clear data"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
