import type { badgeVariants } from "../../badge";
import { type VariantProps } from "class-variance-authority";
import type * as React from "react";

export type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean };
