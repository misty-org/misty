import { NavLink } from "react-router";
import { Button } from "@/components/ui/button";
import AuthCard from "../Auth/AuthCard";
import AuthShell from "../Auth/AuthShell";

export default function NotFound() {
  return (
    <AuthShell
      title="Page not found"
      description="The page you requested does not exist or is no longer available."
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
