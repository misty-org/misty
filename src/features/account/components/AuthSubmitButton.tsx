import { Button } from "@/shared/ui";
import { authFormButtonClass } from "./authButtonClass";

export default function AuthSubmitButton({
  idleLabel,
  loadingLabel,
  loading,
  disabled,
}: AuthSubmitButtonProps) {
  return (
    <Button
      type="submit"
      disabled={disabled || loading}
      variant="primary"
      size="lg"
      className={authFormButtonClass}
    >
      {loading ? loadingLabel : idleLabel}
    </Button>
  );
}

interface AuthSubmitButtonProps {
  idleLabel: string;
  loadingLabel: string;
  loading: boolean;
  disabled?: boolean;
}
