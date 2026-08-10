import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface DesktopSettingsNavEntry<Id extends string = string> {
  id: Id;
  label: string;
  icon: LucideIcon;
}

export interface DesktopSettingsFrameProps<Id extends string> {
  activeId: Id;
  ariaLabel: string;
  children: ReactNode;
  description?: ReactNode;
  items: readonly DesktopSettingsNavEntry<Id>[];
  navigationLabel: string;
  navigationTitle: string;
  onClose?: () => void;
  onSelect: (id: Id) => void;
  presentation?: "page" | "overlay";
  title: ReactNode;
}
