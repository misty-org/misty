import { Button } from "@/shared/ui";
import { authFormButtonClass } from "./authButtonClass";

export default function AuthSubmitButton({ idleLabel, loading, disabled }: AuthSubmitButtonProps) {
  return (
    <Button
      type="submit"
      disabled={disabled}
      loading={loading}
      variant="primary"
      size="lg"
      className={authFormButtonClass}
    >
      {idleLabel}
    </Button>
  );
}

interface AuthSubmitButtonProps {
  idleLabel: string;
  loading: boolean;
  disabled?: boolean;
}
