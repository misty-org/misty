import { NavLink } from "react-router";

import { Button } from "@/components/ui/button";
import { marketingCopy } from "@/content/marketingCopy";
import AuthCard from "../Auth/AuthCard";
import AuthShell from "../Auth/AuthShell";

export default function Register() {
  return (
    <AuthShell
      title={marketingCopy.auth.registerTitle}
      description={marketingCopy.auth.registerDescription}
    >
      <AuthCard title="" description="">
        <div className="flex flex-col gap-5 text-center">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Request access for your group</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              We&rsquo;ll contact you when a place is ready.
            </p>
          </div>
          <Button asChild>
            <NavLink to="/waitlist">
              Request beta access
            </NavLink>
          </Button>
          <Button asChild variant="ghost">
            <NavLink to="/signin">Already invited? Sign in</NavLink>
          </Button>
        </div>
      </AuthCard>
    </AuthShell>
  );
}
