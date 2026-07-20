import * as React from "react";
import { CircleAlert, Inbox, ShieldAlert } from "lucide-react";
import { Spinner } from "@/ui";
import { cn } from "@/ui";

export type StateViewProps = Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
};

export type StateTone = "empty" | "error" | "permission" | "loading";

export type LoadingStateProps = Omit<StateViewProps, "icon" | "title"> & {
  title?: React.ReactNode;
  label?: string;
};
