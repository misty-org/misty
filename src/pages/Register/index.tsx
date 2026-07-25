import { NavLink } from "react-router";

import { Button } from "@/components/ui/button";
import AuthCard from "../Auth/AuthCard";
import AuthShell from "../Auth/AuthShell";

export default function Register() {
  return (
    <AuthShell
      title="Join Misty"
      description="Sign in to join your group and start working together in one shared Space."
    >
      <AuthCard title="" description="">
        <div className="flex flex-col gap-5 text-center">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Continue to Misty
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Your account is the only thing you need to get started.
            </p>
          </div>
          <Button asChild>
            <NavLink to="/signin">Join now</NavLink>
          </Button>
        </div>
      </AuthCard>
    </AuthShell>
  );
}
