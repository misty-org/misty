import { ArrowLeft } from "lucide-react";
import { cn } from "../classNames";
import { Button, type ButtonProps } from "./Button";

/** Going back to the previous page or step: the arrow and the word, as one button. */
export function BackButton({ className, variant = "ghost", size = "sm", ...props }: ButtonProps) {
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn("text-cream-muted hover:text-cream-bright", className)}
      {...props}
    >
      <ArrowLeft data-icon="inline-start" aria-hidden="true" />
      Back
    </Button>
  );
}
