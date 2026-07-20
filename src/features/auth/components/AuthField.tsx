import type { AuthFieldProps } from "@/models/interfaces/features/auth/components/AuthField";
export type { AuthFieldProps } from "@/models/interfaces/features/auth/components/AuthField";
import { Input } from "@/ui";
import { Label } from "@/ui";

export default function AuthField({
  id,
  label,
  type = "text",
  value,
  placeholder,
  autoComplete,
  minLength,
  maxLength,
  pattern,
  required,
  disabled,
  onChange,
}: AuthFieldProps) {
  return (
    <div className="grid gap-2">
      <Label className="text-sm" htmlFor={id}>
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        minLength={minLength}
        maxLength={maxLength}
        pattern={pattern}
        required={required}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 px-4"
      />
    </div>
  );
}
