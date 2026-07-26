import { routePartykitRequest } from "partyserver";

import { NoteRoom, type Env } from "./room";

export { NoteRoom };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env as unknown as Record<string, unknown>)) ??
      new Response("not found", { status: 404 })
    );
  },
};
