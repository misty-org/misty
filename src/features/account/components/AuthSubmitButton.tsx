import { Button } from "@misty/ui";

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
