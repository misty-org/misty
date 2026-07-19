import { Button } from "@/components/ui/button";

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
      className="h-11 w-full"
    >
      {loading ? loadingLabel : idleLabel}
    </Button>
  );
}
