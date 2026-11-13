import type { LocalToolHandler } from "../host";
import { BAD_SCHEMA, readRoute, refuse } from "./api";
import { integer, onlyFields, text, textList } from "./args";
import { listSpaces, spaceArgument, spaceTargets } from "./routing";

const searchAll: LocalToolHandler = async (request) => {
  const { input } = request;
  onlyFields(input, ["query", "space", "kinds", "limit"]);
  const query = text(input, "query", { required: true, min: 1, max: 500 }).trim();
  if (!query) throw refuse(BAD_SCHEMA);
  const kinds = textList(input, "kinds", { max: 5, allowed: ["note", "message"] }) ?? [];
  const limit = integer(input, "limit", 1, 50) ?? 20;
  const reference = spaceArgument(input);
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (kinds.length > 0) params.set("kinds", kinds.join(","));
  // A run searches only its agent's home Space.
  const [space] = spaceTargets(await listSpaces(request), reference, "read");
  params.set("space_id", space.id);
  return readRoute(request, `/search?${params}`);
};

export const searchTools: Record<string, LocalToolHandler> = { "search.all": searchAll };
