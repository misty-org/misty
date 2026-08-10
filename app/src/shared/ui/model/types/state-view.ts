import type * as React from "react";

export type StateViewProps = Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
};

export type StateTone = "empty" | "error" | "permission" | "loading";

export type LoadingStateProps = Omit<StateViewProps, "title"> & {
  title?: React.ReactNode;
  label?: string;
};
