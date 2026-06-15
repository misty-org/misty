import { Input, Label } from "@/shared/ui";

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
      <Label className="text-sm text-cream" htmlFor={id}>
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
        className="h-11 px-3.5 text-cream placeholder:text-cream-faint"
      />
    </div>
  );
}

export interface AuthFieldProps {
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
