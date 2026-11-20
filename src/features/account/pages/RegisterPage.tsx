import { routes } from "@/app/shell";
import { InlineLink, Text } from "@misty/ui";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import AuthCard from "../components/AuthCard";
import AuthShell from "../components/AuthShell";
import RegisterForm from "../components/RegisterForm";
import { ServerStep, useNeedsServer } from "../setup/ServerStep";
import { useFinishSignIn } from "../sign-in-sheet/useFinishSignIn";

export default function RegisterPage() {
  const location = useLocation();
  const navigate = useNavigate();
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
          <Text bare size="control" tone="muted">
            Already have an account?{" "}
            <InlineLink onClick={() => navigate("/signin", { state: { from, addingAccount } })}>
              Sign in
            </InlineLink>
          </Text>
        }
      >
        <RegisterForm onSuccess={finishSignIn} />
      </AuthCard>
    </AuthShell>
  );
}
