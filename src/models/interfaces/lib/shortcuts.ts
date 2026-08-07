import type { ShortcutBinding } from "@/models/interfaces/services/misty-api";

import type { ShortcutMap } from "@/models/types/lib/shortcuts";

export interface ParsedShortcut {
  alt: boolean;
  ctrl: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
}
