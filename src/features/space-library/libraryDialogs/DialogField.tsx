import type { SpaceLibraryItem } from "@/services/spaces/dto/interfaces/types";
import { Label } from "@/shared/ui";
import type { ReactNode } from "react";
import { LibrarySelect } from "../libraryPrimitives/LibrarySelect";

export function DialogField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="grid gap-2">
      <span>{label}</span>
      {children}
    </Label>
  );
}

/** Cover picker shared by the album and person dialogs; "" means automatic. */
export function CoverSelect({
  value,
  items,
  label,
  onChange,
}: {
  value: string;
  items: SpaceLibraryItem[];
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <DialogField label="Cover">
      <LibrarySelect
        value={value}
        onChange={onChange}
        label={label}
        options={[
          ["", "Automatic"],
          ...items.map((item): [string, string] => [item.id, item.display_name]),
        ]}
      />
    </DialogField>
  );
}
