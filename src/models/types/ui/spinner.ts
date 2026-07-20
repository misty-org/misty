import * as React from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/ui";

export type SpinnerProps = React.HTMLAttributes<HTMLSpanElement> & {
  label?: string;
  size?: "sm" | "default" | "lg";
};
