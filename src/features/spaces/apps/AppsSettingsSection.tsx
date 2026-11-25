import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  notify,
} from "@misty/ui";
import { useState } from "react";
import { DesktopSettingsRow } from "@/features/settings";
import { invoke } from "@/native";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function AppsSettingsSection() {
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);

  const signOut = async () => {
    setWorking(true);
    try {
      await invoke<void>("space_apps_sign_out");
      setAsking(false);
      notify({ message: "Signed out of all apps on this computer" });
    } catch (error) {
      notify({ message: messageOf(error), tone: "error" });
    } finally {
      setWorking(false);
    }
  };

  const forget = () =>
    invoke<void>("space_apps_forget_permissions").then(
      () =>
        notify({ message: "Apps will ask again before using your camera, microphone or location" }),
      (error: unknown) => notify({ message: messageOf(error), tone: "error" }),
    );

  return (
    <>
      <DesktopSettingsRow
        label="Sign out of all apps"
        description="Every app in your Spaces, on this computer."
      >
        <Button variant="secondary" onClick={() => setAsking(true)}>
          Sign out
        </Button>
        <AlertDialog open={asking} onOpenChange={(open) => !working && setAsking(open)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign out of all apps?</AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={working}
                onClick={(event) => {
                  event.preventDefault();
                  void signOut();
                }}
              >
                Sign out
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DesktopSettingsRow>
      <DesktopSettingsRow
        label="Camera, microphone and location"
        description="What you let each app use."
      >
        <Button variant="secondary" onClick={() => void forget()}>
          Reset
        </Button>
      </DesktopSettingsRow>
    </>
  );
}
