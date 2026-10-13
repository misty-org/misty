import { Button } from "@/shared/ui";

export default function AuthSubmitButton({
  idleLabel,
  loadingLabel,
  loading,
  disabled,
}: AuthSubmitButtonProps) {
  return (
    <Button type="submit" disabled={disabled || loading} variant="primary" className="h-10 w-full">
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
