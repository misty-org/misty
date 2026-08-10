export interface WaitlistFormState {
  email: string;
  name: string;
}

export interface WaitlistFormProps {
  onSuccess?: () => void;
  className?: string;
}
