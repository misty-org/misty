import { useEffect, useState } from "react";
import { apiRequest } from "@/api/client";
import { notify } from "@misty/ui";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsRowSkeleton,
  DesktopSettingsSection as Section,
} from "@/features/settings";
import { DropdownControl } from "@/features/settings/SettingsControls";
import { useDoNotDisturb } from "@/shared/lib/doNotDisturb";

interface ChosenStatus {
  chosen: "online" | "dnd" | "invisible";
  custom_text?: string;
  custom_emoji?: string;
  custom_expires_at?: string | null;
}

const shows = [
  { value: "online", label: "Online" },
  { value: "dnd", label: "Do not disturb" },
  { value: "invisible", label: "Invisible" },
];

/**
 * Settings › Profile › Status: how the person shows to others. Online turns Idle by itself after
 * a while without use; Do not disturb also silences this computer's notices. It belongs to the
 * account, so it is saved on the server as it is chosen.
 */
export function StatusSection() {
  const [status, setStatus] = useState<ChosenStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    apiRequest<ChosenStatus>("/me/status")
      .then((value) => {
        if (!live) return;
        setStatus(value);
        useDoNotDisturb.getState().set(value.chosen === "dnd");
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const choose = (chosen: string) => {
    if (!status) return;
    const next = { ...status, chosen: chosen as ChosenStatus["chosen"] };
    apiRequest<ChosenStatus>("/me/status", { method: "PUT", body: JSON.stringify(next) })
      .then((saved) => {
        setStatus(saved);
        useDoNotDisturb.getState().set(saved.chosen === "dnd");
      })
      .catch(() => notify({ message: "Your status couldn't be changed. Try again.", tone: "error" }));
  };

  return (
    <Section title="Status">
      {status ? (
        <Row label="Show as">
          <DropdownControl value={status.chosen} options={shows} disabled={false} onValueChange={choose} />
        </Row>
      ) : failed ? (
        <Row label="Show as" description="Your status couldn't be read. Check your connection.">
          <></>
        </Row>
      ) : (
        <DesktopSettingsRowSkeleton label="Status" control="select" />
      )}
    </Section>
  );
}
