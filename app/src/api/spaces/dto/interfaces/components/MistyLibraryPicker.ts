import type { ReactNode } from "react";

export interface MistyLibraryPickerProps {
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
