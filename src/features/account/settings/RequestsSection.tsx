import { useEffect, useState } from "react";
import { apiRequest } from "@/api/client";
import { notify } from "@misty/ui";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsRowSkeleton,
  DesktopSettingsSection as Section,
} from "@/features/settings";
import { DropdownControl } from "@/features/settings/SettingsControls";

type Who = "everyone" | "shared_spaces";

const choices = [
  { value: "everyone", label: "Everyone" },
  { value: "shared_spaces", label: "People I share a Space with" },
];

/** Settings › Profile › Requests: who may send the person a friend request. Kept on the account. */
export function RequestsSection() {
  const [who, setWho] = useState<Who | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    apiRequest<{ friend_requests: Who }>("/me/privacy")
      .then((value) => live && setWho(value.friend_requests))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const choose = (value: string) =>
    apiRequest<{ friend_requests: Who }>("/me/privacy", {
      method: "PUT",
      body: JSON.stringify({ friend_requests: value }),
    })
      .then((saved) => setWho(saved.friend_requests))
      .catch(() => notify({ message: "That couldn't be changed. Try again.", tone: "error" }));

  return (
    <Section title="Requests">
      {who ? (
        <Row label="Who can send me friend requests">
          <DropdownControl value={who} options={choices} disabled={false} onValueChange={choose} />
        </Row>
      ) : failed ? (
        <Row label="Who can send me friend requests" description="This couldn't be read. Check your connection.">
          <></>
        </Row>
      ) : (
        <DesktopSettingsRowSkeleton label="Requests" control="select" />
      )}
    </Section>
  );
}
