import type { LocalToolHandler, LocalToolRequest } from "../host";
import {
  readRoute,
  refuse,
  rewordRefusal,
  segment,
  spacePath,
  writeRoute,
  type SpaceCallRefused,
} from "./api";
import { onlyFields, text } from "./args";
import { isPersonalSpace, listSpaces, namedSpace, type SpaceRow } from "./routing";

const ACTIONS = [
  "create",
  "rename",
  "invite",
  "list_invitations",
  "cancel_invitation",
  "resend_invitation",
  "remove_member",
  "leave",
] as const;

const LIMIT_CODES = [
  "space_limit_reached",
  "space_ownership_limit_reached",
  "space_people_limit_reached",
];

/** Explains refusals the model can act on; nothing changed. */
function adminRefusal(refused: SpaceCallRefused): string | undefined {
  if (refused.code === "forbidden") return "only the Space owner can do that";
  if (refused.status === 404) return "that Space, member or invitation was not found";
  if (refused.code === "invalid_request") return "those values are not valid for this action";
  if (refused.code === "default_space_protected") {
    return "the personal Space cannot be left or shared that way";
  }
  if (LIMIT_CODES.includes(refused.code)) return "this account has reached its plan limit for that";
  return undefined;
}

const list: LocalToolHandler = async (request) => {
  onlyFields(request.input, []);
  // The run sees only its agent's home Space, the one Space it works in.
  const spaces = await listSpaces(request);
  return {
    spaces: spaces.map((space) => ({
      id: space.id,
      name: space.name,
      personal: isPersonalSpace(space),
      shared: space.is_shared,
      home: true,
    })),
  };
};

interface Invitation {
  id: string;
  link?: string;
  emailed?: boolean;
}

async function act(request: LocalToolRequest, action: string, space: SpaceRow) {
  const { input } = request;
  const name = text(input, "name", { min: 1, max: 80 });
  const email = text(input, "email", { min: 1, max: 320 });
  const invitationId = text(input, "invitation_id", { min: 1, max: 200 }).trim();
  const memberId = text(input, "member_id", { min: 1, max: 200 }).trim();
  switch (action) {
    case "rename": {
      if (!name.trim()) throw refuse("rename needs a name");
      const renamed = await writeRoute<{ name: string }>(request, spacePath(space.id), "PATCH", {
        name,
      });
      return { space: { id: space.id, name: renamed.name } };
    }
    case "list_invitations":
      return readRoute<{ invitations: unknown[] }>(request, spacePath(space.id, "/invitations"));
    case "resend_invitation": {
      const path = spacePath(space.id, `/invitations/${segment(invitationId)}/resend`);
      const invite = await writeRoute<Invitation>(request, path, "POST");
      return { resent: invite.id, link: invite.link, emailed: invite.emailed === true };
    }
    case "cancel_invitation":
      await writeRoute(
        request,
        spacePath(space.id, `/invitations/${segment(invitationId)}`),
        "DELETE",
      );
      return { canceled: input.invitation_id };
    case "invite": {
      if (!email.includes("@")) throw refuse("invite needs the person's email address");
      const path = spacePath(space.id, "/invitations");
      const invite = await writeRoute<Invitation>(request, path, "POST", { email });
      return {
        invited: email,
        invitation_id: invite.id,
        link: invite.link,
        emailed: invite.emailed === true,
      };
    }
    case "remove_member":
      if (!memberId) throw refuse("remove_member needs member_id from space_member_list");
      await writeRoute(request, spacePath(space.id, `/members/${segment(memberId)}`), "DELETE");
      return { removed: input.member_id, space: space.name };
    default:
      await writeRoute(request, spacePath(space.id, "/leave"), "POST");
      return { left: space.name };
  }
}

const manage: LocalToolHandler = async (request) => {
  const { input } = request;
  onlyFields(input, ["action", "space", "name", "email", "invitation_id", "member_id"]);
  const action = text(input, "action", { required: true, allowed: ACTIONS });
  if (action === "create") {
    const name = text(input, "name", { min: 1, max: 80 });
    if (!name.trim()) throw refuse("create needs a name");
    // A retried create with this key answers with the Space the first one made.
    const headers = { "Idempotency-Key": `agent:${request.runId}:${request.callId}` };
    const created = await rewordRefusal(
      () =>
        writeRoute<{ space: { id: string; name: string } }>(
          request,
          "/spaces",
          "POST",
          { name },
          headers,
        ),
      adminRefusal,
    );
    return { space: { id: created.space.id, name: created.space.name } };
  }
  const space = await namedSpace(request);
  return rewordRefusal(() => act(request, action, space), adminRefusal);
};

export const spaceAdminTools: Record<string, LocalToolHandler> = {
  "space.list": list,
  "space.manage": manage,
};
