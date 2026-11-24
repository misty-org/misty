import { LogIn } from "lucide-react";
import { Button } from "@misty/ui";

export function SignInButton({
  label,
  disabled,
  size,
  onSignIn,
}: {
  label?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  onSignIn: () => void;
}) {
  return (
    <Button icon={LogIn} size={size} aria-label={label} disabled={disabled} onClick={onSignIn}>
      Sign in
    </Button>
  );
}
