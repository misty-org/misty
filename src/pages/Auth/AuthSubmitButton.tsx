import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

interface AuthSubmitButtonProps {
  idleLabel: string;
  loadingLabel: string;
  loading: boolean;
  disabled?: boolean;
}

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
      size="lg"
      aria-busy={loading}
      className="h-11 w-full"
    >
      {loading ? <Spinner aria-hidden="true" /> : null}
      {loading ? loadingLabel : idleLabel}
    </Button>
  );
}
