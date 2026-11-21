import { useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, MemberGroupHeading, MemberList, MemberRow, notify } from "@misty/ui";
import { personInitials } from "@/shared/lib/personInitials";
import { personTone } from "@/shared/lib/personTone";
import { directApi, type Person } from "./api";
import { dmPath, reloadDms } from "./directData";
import { useCustomStatus, usePresence } from "./statusStore";

function DmMember({ person, self }: { person: Person; self: boolean }) {
  const navigate = useNavigate();
  const presence = usePresence(person.user_id);
  const custom = useCustomStatus(person.user_id);
  // Someone else opens your own DM with them; only friends have one, so it can be refused.
  const open = async () => {
    try {
      const dm = await directApi.openDm(person.user_id);
      await reloadDms().catch(() => undefined);
      navigate(dmPath(dm.id));
    } catch (reason) {
      notify({
        tone: "error",
        message: reason instanceof Error ? reason.message : "That conversation couldn't be opened.",
      });
    }
  };
  return (
    <MemberRow
      avatar={
        <Avatar size="sm" tone={personTone(person.user_id)}>
          <AvatarFallback>{personInitials(person.username)}</AvatarFallback>
        </Avatar>
      }
      name={self ? `${person.username} (you)` : person.username}
      presence={presence}
      line={custom || undefined}
      onOpen={self ? undefined : () => void open()}
    />
  );
}

/** The people in a DM, beside its messages, as Discord lists a group DM's members. */
export function DmMembers({ members, me }: { members: Person[]; me: string }) {
  return (
    <MemberList label="Members">
      <MemberGroupHeading title="Members" count={members.length} />
      {members.map((person) => (
        <DmMember key={person.user_id} person={person} self={person.user_id === me} />
      ))}
    </MemberList>
  );
}
