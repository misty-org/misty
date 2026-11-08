import type { ComponentType, ReactNode } from "react";
import { createPort } from "@/shared/lib/seams";

export interface LibraryPickerProps {
  spaceId: string;
  /** Render only the picker panel when a parent owns the shared dialog shell. */
  embedded?: boolean;
  /** Whether this embedded panel is currently visible. */
  active?: boolean;
  /** Source switcher rendered in the header when this picker is hosted by MistyPicker. */
  sourceToggle?: ReactNode;
  selectedIds: string[];
  maximumSelected?: number;
  onCancel: () => void;
  onChoose: (itemIds: string[]) => void;
}

/** The Library picker belongs to Spaces, which sits above files and fills this in at startup. */
export const libraryPicker = createPort<ComponentType<LibraryPickerProps>>("the Library picker");

export function LibraryPickerPanel(props: LibraryPickerProps) {
  const Picker = libraryPicker.maybe();
  return Picker ? <Picker {...props} /> : null;
}
