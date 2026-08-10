import type { buttonVariants } from "../../button";
import { type VariantProps } from "class-variance-authority";
import type * as React from "react";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}
