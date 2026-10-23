import { openSignInSheet } from "@/features/auth";
import { Button } from "@/shared/ui";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "@/features/settings/desktop";

/** Sync while nobody is signed in: what it would do, a way in, and where things are kept now
 * (docs/browser/no-account.md). */
export function SignedOutSyncSettings() {
  return (
    <>
      <Section
        title="Sync"
        description="Sync keeps your browsing the same on every device you sign in on, end-to-end encrypted: Misty's servers hold only data they can't read."
      >
        <Row
          label="Sync is off"
          description="Sign in to sync tabs, bookmarks, passwords, history and extensions."
        >
          <Button variant="primary" size="sm" onClick={() => openSignInSheet("sync")}>
            Sign in
          </Button>
        </Row>
      </Section>
      <Section
        title="On this device"
        description="Without an account, everything stays on this device, encrypted with a key in the system keychain. Nothing is sent to Misty."
      >
        <Row
          label="Bookmarks, passwords and history"
          description="Kept on this device. Signing in later brings them into your account."
        >
          <span className="text-sm text-cream-muted">On this device</span>
        </Row>
      </Section>
    </>
  );
}
