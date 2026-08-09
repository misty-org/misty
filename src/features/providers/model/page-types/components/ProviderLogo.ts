import type { Cloud } from "lucide-react";
import type { IconType } from "react-icons";

export type ProviderLogoSpec =
  | { kind: "react"; icon: IconType; color?: string }
  | { kind: "lucide"; icon: typeof Cloud; color?: string }
  | { kind: "asset"; src: string };
