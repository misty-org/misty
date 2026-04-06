import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
