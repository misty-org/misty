import { ArrowLeft } from "lucide-react";
import * as React from "react";

import { Button, type ButtonProps } from "./Button";

/** Going back to the previous page or step: the arrow and the word, as one quiet button. */
const BackButton = React.forwardRef<HTMLButtonElement, Omit<ButtonProps, "icon">>(
  ({ variant = "quiet", type = "button", children = "Back", ...props }, ref) => (
    <Button ref={ref} type={type} variant={variant} icon={ArrowLeft} {...props}>
      {children}
    </Button>
  ),
);
BackButton.displayName = "BackButton";

export { BackButton };
