import { routes } from "@/features/app-shell";
import { Button, PermissionState } from "@/shared/ui";
import { Link } from "react-router-dom";

export function WebUnavailablePage(props: { feature: string }) {
  return (
    <div className="grid min-h-full place-items-center px-4">
      <PermissionState
        title={`${props.feature} is available in the Misty desktop app`}
        description="This feature uses local-device capabilities that browsers do not provide. Spaces and cloud-backed collaboration are available on the web."
        action={
          <Button asChild variant="outline">
            <Link to={routes.spaces}>Open Spaces</Link>
          </Button>
        }
      />
    </div>
  );
}
