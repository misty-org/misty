import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui";

// Radix rejects an empty string as an item value, so "no selection" round-trips
// through this sentinel instead.
const NONE = "__none__";

export function LibrarySelect({
  value,
  options,
  onChange,
  label,
  className = "",
}: {
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <Select value={value || NONE} onValueChange={(next) => onChange(next === NONE ? "" : next)}>
      <SelectTrigger className={className} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([id, name]) => (
          <SelectItem value={id || NONE} key={id || NONE}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
