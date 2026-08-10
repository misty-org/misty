import { NavLink } from "react-router";
import { Button } from "@/components/ui/button";
import AuthCard from "../Auth/AuthCard";
import AuthShell from "../Auth/AuthShell";
import { marketingCopy } from "@/content/marketingCopy";

export default function NotFound() {
  return (
    <AuthShell
      title="Page not found"
      description={marketingCopy.auth.notFoundDescription}
    >
      <AuthCard>
        <div className="text-center">
          <Button asChild size="lg">
            <NavLink to="/">Go home</NavLink>
          </Button>
        </div>
      </AuthCard>
    </AuthShell>
  );
}
