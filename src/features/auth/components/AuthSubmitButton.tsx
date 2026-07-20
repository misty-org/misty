import type { AuthSubmitButtonProps } from "@/models/interfaces/features/auth/components/AuthSubmitButton";
export type { AuthSubmitButtonProps } from "@/models/interfaces/features/auth/components/AuthSubmitButton";
import { Button } from "@/ui";

export default function AuthSubmitButton({
  idleLabel,
  loadingLabel,
  loading,
  disabled,
}: AuthSubmitButtonProps) {
  return (
    <Button type="submit" disabled={disabled || loading} className="h-11 w-full">
      {loading ? loadingLabel : idleLabel}
    </Button>
  );
}
