import {
  File,
  History,
  Image as ImageIcon,
  MessagesSquare,
  Pencil,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

const utilityIcons: Record<string, LucideIcon> = {
  featured: Sparkles,
  "recently-edited": SlidersHorizontal,
  "recently-shared": MessagesSquare,
  screenshots: ImageIcon,
  handwriting: Pencil,
  illustrations: Sparkles,
  documents: File,
  receipts: File,
  "qr-codes": File,
};

export function libraryUtilityIcon(value: string): LucideIcon {
  return utilityIcons[value] ?? History;
}
