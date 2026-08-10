import {
  CreditCard,
  Lock,
  Sparkles,
  UserCircle,
  type LucideIcon,
} from "lucide-react";

export type Tab = "account" | "usage" | "billing" | "privacy";

export const TABS: readonly { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "account", label: "Account", icon: UserCircle },
  { id: "usage", label: "Usage", icon: Sparkles },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "privacy", label: "Privacy", icon: Lock },
];

export const TAB_DESCRIPTIONS: Record<Tab, string> = {
  account: "Review your Misty account and profile details.",
  usage: "Review pooled storage and weekly agent usage.",
  billing: "Review your plan and manage subscription billing.",
  privacy: "Understand how Misty handles your files and account data.",
};
