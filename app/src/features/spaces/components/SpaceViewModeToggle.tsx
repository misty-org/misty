import { ToggleGroup, ToggleGroupItem, cn } from "@/shared/ui";

export function SpaceViewModeToggle<T extends string>(props: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={props.value}
      variant="outline"
      size="sm"
      spacing={1}
      className={cn(
        "shrink-0 rounded-full border border-charcoal-border/70 bg-charcoal-sidebar p-0.5 shadow-none",
        props.className,
      )}
      aria-label={props.label}
      onValueChange={(value) => {
        if (value) props.onChange(value as T);
      }}
    >
      {props.options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className={cn(
            "h-6 min-w-0 rounded-full px-2.5 text-xs font-medium transition-colors",
            "border-0 data-[state=on]:bg-charcoal-active data-[state=on]:text-cream-bright",
            "text-cream-muted hover:bg-charcoal-hover/60 hover:text-cream",
            "data-[state=on]:hover:bg-charcoal-active",
          )}
          aria-label={`${option.label} view`}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
