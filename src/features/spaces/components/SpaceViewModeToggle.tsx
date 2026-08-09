import { ToggleGroup, ToggleGroupItem } from "@/shared/ui";

export function SpaceViewModeToggle<T extends string>(props: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={props.value}
      variant="outline"
      size="sm"
      spacing={0}
      className="shrink-0"
      aria-label={props.label}
      onValueChange={(value) => {
        if (value) props.onChange(value as T);
      }}
    >
      {props.options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className="h-7 min-w-0 px-2.5 text-xs font-medium"
          aria-label={`${option.label} view`}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
