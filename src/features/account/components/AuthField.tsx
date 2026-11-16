import { Field, Input } from "@/shared/ui";

/** One labeled field on a signed-out form: the shared Field and Input, at their own size. */
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
    <Field label={label}>
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
      />
    </Field>
  );
}

interface AuthFieldProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  placeholder?: string;
  autoComplete?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  required?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}
