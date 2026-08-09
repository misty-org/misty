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
