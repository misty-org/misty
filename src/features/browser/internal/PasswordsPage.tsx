import { Button, EmptyState } from "@/shared/ui";
import { useEffect } from "react";
import { InternalPageFrame } from "./InternalPageFrame";

function openPasswordSettings() {
  window.dispatchEvent(
    new CustomEvent("misty:open-settings", { detail: { section: "passwords" } }),
  );
}

/** misty://passwords leads to where saved passwords are managed now: Settings. */
export function PasswordsPage() {
  useEffect(openPasswordSettings, []);
  return (
    <InternalPageFrame title="Passwords">
      <EmptyState
        title="Passwords"
        description="See, add and remove saved sign-ins in Settings."
        action={
          <Button variant="primary" onClick={openPasswordSettings}>
            Open Passwords settings
          </Button>
        }
      />
    </InternalPageFrame>
  );
}
