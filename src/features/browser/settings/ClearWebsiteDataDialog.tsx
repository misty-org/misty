import { CalendarDays, Clock, History } from "lucide-react";
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
  useNotice,
} from "@/shared/ui";
import { browserLibrary, type BrowserWebsiteDataKind } from "../library/native";

// Every menu row starts with an icon: a clock for the recent spans, history for all of it.
const ranges = [
  { label: "Last hour", ms: 3_600_000, icon: Clock },
  { label: "Last 24 hours", ms: 86_400_000, icon: Clock },
  { label: "Last 7 days", ms: 7 * 86_400_000, icon: CalendarDays },
  { label: "All time", ms: Number.POSITIVE_INFINITY, icon: History },
];

const choices: { id: BrowserWebsiteDataKind; label: string; detail: string }[] = [
  { id: "cookies", label: "Cookies and site data", detail: "Signs agents out of most websites." },
  {
    id: "cache",
    label: "Cached images and files",
    detail: "Some sites may load more slowly next time.",
  },
];

/** Clears what websites stored on this computer for the pages agents open. */
export function ClearWebsiteDataDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCleared(): void;
}) {
  const [range, setRange] = useState(1);
  const [selected, setSelected] = useState<Set<BrowserWebsiteDataKind>>(new Set(["cache"]));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useNotice(Boolean(error), {
    message: error ?? "",
    tone: "error",
    onDismiss: () => setError(null),
  });
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
        <DialogDescription>Applies to the pages agents open on this computer.</DialogDescription>
        <Field label="Time range">
          <Select value={String(range)} onValueChange={(value) => setRange(Number(value))}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ranges.map((item, index) => (
                <SelectItem
                  key={item.label}
                  value={String(index)}
                  icon={item.icon}
                  label={item.label}
                />
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
        <DialogFooter>
          <Button type="button" variant="quiet" size="lg" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="lg"
            disabled={working || !selected.size}
            onClick={() => void clear()}
          >
            {working ? "Clearing…" : "Clear data"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
