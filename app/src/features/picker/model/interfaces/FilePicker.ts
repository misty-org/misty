import type { ReactNode } from "react";

import type { MistyFilePickerMode } from "../types/FilePicker";

export interface MistyFilePickerProps {
  mode: MistyFilePickerMode;
  /** Render only the picker panel when a parent owns the shared dialog shell. */
  embedded?: boolean;
  /** Whether this embedded panel is currently visible. */
  active?: boolean;
  multiple?: boolean;
  title?: string;
  initialPath?: string | null;
  allowedExtensions?: string[];
  /** Source switcher rendered in the header when this picker is hosted by MistyPicker. */
  sourceToggle?: ReactNode;
  onCancel: () => void;
  onSelect: (path: string) => void;
  onSelectMany?: (paths: string[]) => void;
}
