import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import AuthCard from "./components/AuthCard";
import AuthShell from "./components/AuthShell";
import RegisterForm from "./components/RegisterForm";

export default function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const routeState = location.state as { from?: string; addingAccount?: boolean } | null;
  const rawFrom = routeState?.from;
  const from =
    rawFrom && !rawFrom.startsWith("/signin") && !rawFrom.startsWith("/register")
      ? rawFrom
      : "/browser";
  const addingAccount = Boolean(routeState?.addingAccount || user);

  return (
    <AuthShell
      title={addingAccount ? "Create another account" : "Create an account"}
      onBack={addingAccount ? () => navigate(from, { replace: true }) : undefined}
    >
      <AuthCard
        footer={
          <NavLink
            to="/signin"
            state={{ from, addingAccount }}
            className="text-sm font-medium text-cream underline-offset-4 hover:underline"
          >
            Already have an account? Sign in
          </NavLink>
        }
      >
        <RegisterForm onSuccess={() => navigate(from, { replace: true })} />
      </AuthCard>
    </AuthShell>
  );
}
