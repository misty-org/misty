import { z } from "zod";
import { mistyCapabilityServerContracts } from "./capabilities.js";
import { mistyJournalAssetServerContracts } from "./journal-assets.js";
import { mistyPlannerContracts } from "./planner.js";
import { mistyConnectionContracts } from "./connections.js";
import { mistyMailContracts } from "./mail.js";
import * as model from "./models.js";
import * as input from "./requests.js";

export const MISTY_APP_PROTOCOL_VERSION = 2 as const;
export const AppRpcErrorSchema = z.looseObject({
  code: z.string().min(1),
  message: z.string().optional(),
});
export type AppRpcError = z.output<typeof AppRpcErrorSchema>;
export type MethodContract = Readonly<{
  verb: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  params: z.ZodType;
  result: z.ZodType;
}>;
const params = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);
const space = { path: input.SpacePathSchema.optional() };
const list = <K extends string, T extends z.ZodType>(key: K, schema: T) =>
  z.looseObject({ [key]: z.array(schema).nullable() } as {
    [P in K]: z.ZodNullable<z.ZodArray<T>>;
  });

/** Only app capabilities belong here. Host credentials and administrative routes are excluded. */
export const mistyServerContracts = {
  ...mistyCapabilityServerContracts,
  ...mistyPlannerContracts,
  ...mistyJournalAssetServerContracts,
  ...mistyConnectionContracts,
  ...mistyMailContracts,
  "spaces.get": {
    verb: "GET",
    path: "/spaces/{spaceID}",
    params: input.EmptyParamsSchema,
    result: model.SpaceSchema,
  },
  "spaces.members.list": {
    verb: "GET",
    path: "/spaces/{spaceID}/members",
    params: input.EmptyParamsSchema,
    result: z.looseObject({
      members: z.array(model.SpaceMemberSchema).nullable(),
    }),
  },
  "notes.list": {
    verb: "GET",
    path: "/spaces/{spaceID}/notes",
    params: input.EmptyParamsSchema,
    result: list("notes", model.SpaceNoteSchema),
  },
  "notes.get": {
    verb: "GET",
    path: "/spaces/{spaceID}/notes/{noteID}",
    params: input.NoteParamsSchema,
    result: model.SpaceNoteSchema,
  },
  "notes.create": {
    verb: "POST",
    path: "/spaces/{spaceID}/notes",
    params: params({ ...space, body: input.TitleInputSchema }),
    result: model.SpaceNoteSchema,
  },
  "notes.update": {
    verb: "PATCH",
    path: "/spaces/{spaceID}/notes/{noteID}/metadata",
    params: params({
      path: input.NotePathSchema,
      body: input.NoteMetadataInputSchema,
    }),
    result: model.SpaceNoteSchema,
  },
  "notes.archive": {
    verb: "PATCH",
    path: "/spaces/{spaceID}/notes/{noteID}",
    params: params({
      path: input.NotePathSchema,
      body: z.strictObject({ archived: z.boolean() }),
    }),
    result: z.undefined(),
  },
  "notes.delete": {
    verb: "DELETE",
    path: "/spaces/{spaceID}/notes/{noteID}",
    params: input.NoteParamsSchema,
    result: z.undefined(),
  },
  "notes.backlinks": {
    verb: "GET",
    path: "/spaces/{spaceID}/notes/{noteID}/backlinks",
    params: input.NoteParamsSchema,
    result: list("backlinks", model.SpaceNoteBacklinkSchema),
  },
  "notes.collaboration.ticket": {
    verb: "POST",
    path: "/spaces/{spaceID}/notes/{noteID}/collaboration-ticket",
    params: input.NoteParamsSchema,
    result: model.JournalTicketSchema,
  },
  "drawings.list": {
    verb: "GET",
    path: "/spaces/{spaceID}/drawings",
    params: input.EmptyParamsSchema,
    result: list("drawings", model.SpaceDrawingSchema),
  },
  "drawings.get": {
    verb: "GET",
    path: "/spaces/{spaceID}/drawings/{drawingID}",
    params: input.DrawingParamsSchema,
    result: model.SpaceDrawingSchema,
  },
  "drawings.create": {
    verb: "POST",
    path: "/spaces/{spaceID}/drawings",
    params: params({ ...space, body: input.TitleInputSchema }),
    result: model.SpaceDrawingSchema,
  },
  "drawings.update": {
    verb: "PATCH",
    path: "/spaces/{spaceID}/drawings/{drawingID}",
    params: params({
      path: input.DrawingPathSchema,
      body: input.TitleInputSchema,
    }),
    result: model.SpaceDrawingSchema,
  },
  "drawings.delete": {
    verb: "DELETE",
    path: "/spaces/{spaceID}/drawings/{drawingID}",
    params: input.DrawingParamsSchema,
    result: z.undefined(),
  },
  "drawings.collaboration.ticket": {
    verb: "POST",
    path: "/spaces/{spaceID}/drawings/{drawingID}/collaboration-ticket",
    params: input.DrawingParamsSchema,
    result: model.JournalTicketSchema,
  },
  "tasks.list": {
    verb: "GET",
    path: "/spaces/{spaceID}/tasks",
    params: params({ ...space, query: input.TaskQuerySchema.optional() }),
    result: model.SpaceTaskPageSchema,
  },
  "tasks.create": {
    verb: "POST",
    path: "/spaces/{spaceID}/tasks",
    params: params({ ...space, body: input.TaskCreateInputSchema }),
    result: model.SpaceTaskSchema,
  },
  "tasks.update": {
    verb: "PATCH",
    path: "/spaces/{spaceID}/tasks/{taskID}",
    params: params({
      path: input.TaskPathSchema,
      body: input.TaskUpdateInputSchema,
    }),
    result: model.SpaceTaskSchema,
  },
  "tasks.delete": {
    verb: "DELETE",
    path: "/spaces/{spaceID}/tasks/{taskID}",
    params: params({
      path: input.TaskPathSchema,
      query: input.VersionQuerySchema,
    }),
    result: model.SpaceTaskSchema,
  },
  "roadmaps.list": {
    verb: "GET",
    path: "/spaces/{spaceID}/roadmaps",
    params: input.EmptyParamsSchema,
    result: list("roadmaps", model.SpaceRoadmapSchema),
  },
  "roadmaps.get": {
    verb: "GET",
    path: "/spaces/{spaceID}/roadmaps/{roadmapID}",
    params: input.RoadmapParamsSchema,
    result: model.SpaceRoadmapSnapshotSchema,
  },
  "roadmaps.create": {
    verb: "POST",
    path: "/spaces/{spaceID}/roadmaps",
    params: params({ ...space, body: input.RoadmapCreateInputSchema }),
    result: model.SpaceRoadmapSnapshotSchema,
  },
  "roadmaps.update": {
    verb: "PATCH",
    path: "/spaces/{spaceID}/roadmaps/{roadmapID}",
    params: params({
      path: input.RoadmapPathSchema,
      body: input.RoadmapUpdateInputSchema,
    }),
    result: model.SpaceRoadmapSchema,
  },
  "calendar.events.list": {
    verb: "GET",
    path: "/spaces/{spaceID}/calendar/events",
    params: params({ ...space, query: input.CalendarQuerySchema }),
    result: list("events", model.SpaceCalendarEventSchema),
  },
  "calendar.events.create": {
    verb: "POST",
    path: "/spaces/{spaceID}/calendar/events",
    params: params({ ...space, body: input.CalendarCreateInputSchema }),
    result: model.SpaceCalendarEventSchema,
  },
  "calendar.events.update": {
    verb: "PATCH",
    path: "/spaces/{spaceID}/calendar/events/{eventID}",
    params: params({
      path: input.EventPathSchema,
      body: input.CalendarUpdateInputSchema,
    }),
    result: model.SpaceCalendarEventSchema,
  },
  "calendar.events.delete": {
    verb: "DELETE",
    path: "/spaces/{spaceID}/calendar/events/{eventID}",
    params: params({
      path: input.EventPathSchema,
      query: input.VersionQuerySchema,
    }),
    result: z.undefined(),
  },
} as const satisfies Record<string, MethodContract>;

export type MistyServerMethod = keyof typeof mistyServerContracts;
export type MistyMethodParams<M extends MistyServerMethod> = z.input<
  (typeof mistyServerContracts)[M]["params"]
>;
export type MistyMethodResult<M extends MistyServerMethod> = z.output<
  (typeof mistyServerContracts)[M]["result"]
>;
export const mistyServerMethods = Object.freeze(
  Object.fromEntries(
    Object.entries(mistyServerContracts).map(([method, { verb, path }]) => [
      method,
      { verb, path },
    ]),
  ),
) as {
  readonly [M in MistyServerMethod]: Pick<
    (typeof mistyServerContracts)[M],
    "verb" | "path"
  >;
};

export class MistyContractError extends Error {
  constructor(
    readonly code:
      | "unsupported_protocol"
      | "unsupported_method"
      | "invalid_request"
      | "invalid_params"
      | "invalid_response"
      | "space_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "MistyContractError";
  }
}
export function isMistyServerMethod(
  method: string,
): method is MistyServerMethod {
  return Object.prototype.hasOwnProperty.call(mistyServerContracts, method);
}
export function parseMethodParams<M extends MistyServerMethod>(
  method: M,
  value: unknown,
): MistyMethodParams<M> {
  if (!isMistyServerMethod(method))
    throw new MistyContractError("unsupported_method", "Unknown Misty method.");
  const parsed = mistyServerContracts[method].params.safeParse(value ?? {});
  if (!parsed.success)
    throw new MistyContractError(
      "invalid_params",
      `Invalid parameters for ${method}.`,
    );
  return parsed.data as MistyMethodParams<M>;
}
export function parseMethodResult<M extends MistyServerMethod>(
  method: M,
  value: unknown,
): MistyMethodResult<M> {
  if (!isMistyServerMethod(method))
    throw new MistyContractError("unsupported_method", "Unknown Misty method.");
  const parsed = mistyServerContracts[method].result.safeParse(value);
  if (!parsed.success)
    throw new MistyContractError(
      "invalid_response",
      `Invalid response for ${method}.`,
    );
  return parsed.data as MistyMethodResult<M>;
}
export const AppRpcEnvelopeSchema = z.strictObject({
  protocol: z.number().int(),
  method: z.string(),
  params: z.unknown().optional(),
});
export function parseAppRpcRequest(value: unknown, boundSpaceId: string) {
  const envelope = AppRpcEnvelopeSchema.safeParse(value);
  if (!envelope.success)
    throw new MistyContractError(
      "invalid_request",
      "Invalid App RPC envelope.",
    );
  if (envelope.data.protocol !== MISTY_APP_PROTOCOL_VERSION)
    throw new MistyContractError(
      "unsupported_protocol",
      "Unsupported App RPC protocol.",
    );
  const method = envelope.data.method;
  if (!isMistyServerMethod(method))
    throw new MistyContractError("unsupported_method", "Unknown Misty method.");
  const parsed = parseMethodParams(method, envelope.data.params);
  const path = "path" in parsed ? parsed.path : undefined;
  const requestedSpaceId = path && "spaceID" in path ? path.spaceID : undefined;
  if (requestedSpaceId && requestedSpaceId !== boundSpaceId)
    throw new MistyContractError(
      "space_mismatch",
      "This method belongs to another Space.",
    );
  if (mistyServerContracts[method].path.includes("{spaceID}") && !input.IdentifierSchema.safeParse(boundSpaceId).success)
    throw new MistyContractError(
      "invalid_params",
      "A Space-bound App session is required.",
    );
  const normalizedPath: Record<string, string | undefined> = { ...path };
  if (boundSpaceId) normalizedPath.spaceID = boundSpaceId;
  return {
    protocol: MISTY_APP_PROTOCOL_VERSION,
    method,
    params: { ...parsed, path: normalizedPath },
  };
}
