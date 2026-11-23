import { notify } from "@misty/ui";
import { DesktopSettingsRow as Row, DesktopSettingsSection as Section } from "@/features/settings";
import { DropdownControl } from "@/features/settings/SettingsControls";
import { directApi, type FriendPrivacy } from "../api";
import { useSpaceResource } from "@/features/spaces";

const choices = [
  { value: "everyone", label: "Everyone" },
  { value: "shared_spaces", label: "People I share a Space with" },
];

export function RequestsSection() {
  const privacy = useSpaceResource<FriendPrivacy>("/me/privacy", directApi.privacy);
  const choose = (value: string) =>
    directApi
      .setPrivacy({ friend_requests: value as FriendPrivacy["friend_requests"] })
      .then((saved) => privacy.set(saved))
      .catch(() => notify({ message: "That couldn't be changed. Try again.", tone: "error" }));
  return (
    <Section title="Requests">
      <Row label="Who can send me friend requests">
        <DropdownControl
          value={privacy.data?.friend_requests ?? "everyone"}
          options={choices}
          disabled={!privacy.data}
          onValueChange={(value) => void choose(value)}
        />
      </Row>
    </Section>
  );
}
