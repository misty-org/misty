import { Button } from "@/shared/ui";

/** The form's one primary button. The form's column stretches it to the fields' width. */
export default function AuthSubmitButton({ idleLabel, loading, disabled }: AuthSubmitButtonProps) {
  return (
    <Button type="submit" disabled={disabled || loading} variant="primary" size="lg">
      {idleLabel}
    </Button>
  );
}

interface AuthSubmitButtonProps {
  idleLabel: string;
  loading: boolean;
  disabled?: boolean;
}
