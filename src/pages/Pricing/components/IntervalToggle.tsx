import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { PricingInterval } from "../data";

const itemClass =
  "h-11 rounded-lg px-6 text-base text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs";

export default function IntervalToggle({
  interval,
  onChange,
}: {
  interval: PricingInterval;
  onChange: (interval: PricingInterval) => void;
}) {
  return (
    <div className="mb-12 flex justify-center">
      <ToggleGroup
        type="single"
        value={interval}
        onValueChange={(value) => {
          if (value) onChange(value as PricingInterval);
        }}
        variant="default"
        spacing={1}
        className="rounded-xl border border-border bg-muted/60 p-1.5 shadow-xs"
        aria-label="Billing interval"
      >
        <ToggleGroupItem value="month" className={itemClass}>
          Monthly
        </ToggleGroupItem>
        <ToggleGroupItem value="year" className={itemClass}>
          <span>Yearly</span>
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
