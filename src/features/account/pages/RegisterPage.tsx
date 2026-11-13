import { routes } from "@/app/shell";
import { Text } from "@/shared/ui";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import AuthCard from "../components/AuthCard";
import AuthShell from "../components/AuthShell";
import RegisterForm from "../components/RegisterForm";
import { ServerStep, useNeedsServer } from "../setup/ServerStep";
import { useFinishSignIn } from "../sign-in-sheet/useFinishSignIn";

export default function RegisterPage() {
  const location = useLocation();
  const { user } = useAuth();
  const routeState = location.state as { from?: string; addingAccount?: boolean } | null;
  const rawFrom = routeState?.from;
  const from =
    rawFrom && !rawFrom.startsWith("/signin") && !rawFrom.startsWith("/register")
      ? rawFrom
      : routes.agents;
  const addingAccount = Boolean(routeState?.addingAccount || user);
  const finishSignIn = useFinishSignIn(from, !user);
  const needsServer = useNeedsServer();

  if (needsServer) {
    return (
      <AuthShell title="Create a Misty account">
        <AuthCard>
          <ServerStep />
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={user ? "Create another account" : "Create an account"}>
      <AuthCard
        footer={
          <NavLink
            to="/signin"
            state={{ from, addingAccount }}
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            <Text bare tone="default">
              Already have an account? Sign in
            </Text>
          </NavLink>
        }
      >
        <RegisterForm onSuccess={finishSignIn} />
      </AuthCard>
    </AuthShell>
  );
}
