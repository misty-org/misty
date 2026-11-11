import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  ErrorNotification,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui";
import { browserLibrary, type BrowserWebsiteDataKind } from "../library/native";

const ranges = [
  { label: "Last hour", ms: 3_600_000 },
  { label: "Last 24 hours", ms: 86_400_000 },
  { label: "Last 7 days", ms: 7 * 86_400_000 },
  { label: "All time", ms: Number.POSITIVE_INFINITY },
];

const choices: { id: BrowserWebsiteDataKind; label: string; detail: string }[] = [
  { id: "cookies", label: "Cookies and site data", detail: "Signs agents out of most websites." },
  {
    id: "cache",
    label: "Cached images and files",
    detail: "Some sites may load more slowly next time.",
  },
];

/** Clears what websites stored on this computer, for this window's profile. */
export function ClearWebsiteDataDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCleared(): void;
}) {
  const [range, setRange] = useState(1);
  const [selected, setSelected] = useState<Set<BrowserWebsiteDataKind>>(new Set(["cache"]));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (props.open) setError(null);
  }, [props.open]);

  const clear = async () => {
    const span = ranges[range].ms;
    const since = Number.isFinite(span) ? Date.now() - span : 0;
    setWorking(true);
    setError(null);
    try {
      await browserLibrary.clearWebsiteData({ kinds: [...selected], since });
      props.onOpenChange(false);
      props.onCleared();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Clear website data</DialogTitle>
        <DialogDescription>Applies to this profile on this computer.</DialogDescription>
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
            If Sync is on, website sign-ins saved from another signed-in session can be restored the
            next time this computer syncs.
          </p>
        ) : null}
        <ErrorNotification message={error} onDismiss={() => setError(null)} />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
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
