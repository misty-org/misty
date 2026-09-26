import { Button } from "@/shared/ui";

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
      className="h-11 w-full bg-cream-bright text-charcoal-bg hover:bg-cream"
    >
      {loading ? loadingLabel : idleLabel}
    </Button>
  );
}

export interface AuthSubmitButtonProps {
  idleLabel: string;
  loadingLabel: string;
  loading: boolean;
  disabled?: boolean;
}
