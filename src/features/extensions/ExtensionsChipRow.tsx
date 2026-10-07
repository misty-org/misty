import { Button } from "@/shared/ui";

/**
 * A row of shared chips that narrows the collection: catalog categories under Discover,
 * install states under Installed. It replaces the Extensions sidebar.
 */
export function ExtensionsChipRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange(value: string): void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {options.map((option) => (
        <Button
          key={option.value}
          variant="chip"
          size="sm"
          className="font-normal"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
