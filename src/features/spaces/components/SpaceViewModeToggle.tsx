import { SegmentedControl } from "@/shared/ui";

export function SpaceViewModeToggle<T extends string>(props: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <SegmentedControl
      label={props.label}
      size="xs"
      value={props.value}
      className={props.className}
      options={props.options.map((option) => ({
        ...option,
        ariaLabel: `${option.label} view`,
      }))}
      onChange={props.onChange}
    />
  );
}
