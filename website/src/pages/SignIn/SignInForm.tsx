import { NavLink } from "react-router";
import AuthField from "../Auth/AuthField";
import AuthMessage from "../Auth/AuthMessage";
import AuthSubmitButton from "../Auth/AuthSubmitButton";

interface SignInFormProps {
  email: string;
  password: string;
  loading: boolean;
  error: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onForgotPasswordClick: () => void;
}

export default function SignInForm({
  email,
  password,
  loading,
  error,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onForgotPasswordClick,
}: SignInFormProps) {
  return (
    <>
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <AuthField
          id="signin-email"
          type="email"
          label="Email"
          value={email}
          autoComplete="email"
          placeholder="you@example.com"
          required
          onChange={onEmailChange}
        />

        <div className="flex flex-col gap-2">
          <AuthField
            id="signin-password"
            type="password"
            label="Password"
            value={password}
            autoComplete="current-password"
            placeholder="••••••••"
            required
            onChange={onPasswordChange}
          />
          <button
            type="button"
            onClick={onForgotPasswordClick}
            className="self-start text-sm text-text-muted transition hover:text-text"
          >
            Forgot your password?
          </button>
        </div>

        {error ? <AuthMessage tone="error" message={error} /> : null}

        <AuthSubmitButton idleLabel="Sign In" loadingLabel="Signing in..." loading={loading} />
      </form>

      <div className="text-center text-sm text-text-muted">
        <NavLink to="/register" className="transition hover:text-text">
          Don&apos;t have an account? Sign up
        </NavLink>
      </div>
    </>
  );
}
