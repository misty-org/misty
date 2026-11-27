type Schema = {
  type?: "object" | "string" | "array" | "boolean" | "integer" | "number";
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: string[];
  anyOf?: Schema[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  open?: boolean;
};

const text = (minLength: number, maxLength: number): Schema => ({
  type: "string",
  minLength,
  maxLength,
});
const whole = (minimum: number, maximum: number): Schema => ({ type: "integer", minimum, maximum });
const flag: Schema = { type: "boolean" };
const scopeId = text(8, 256);
const ref: Schema = { type: "string", pattern: "^e[0-9]{1,7}$" };
const documentId = text(8, 64);

function object(properties: Record<string, Schema>, required: string[] = []): Schema {
  return { type: "object", properties, required };
}

const page = (properties: Record<string, Schema> = {}, required: string[] = []) =>
  object({ scopeId, ...properties }, ["scopeId", ...required]);

const step = object(
  {
    action: {
      type: "string",
      enum: [
        "click",
        "fill",
        "type",
        "select",
        "check",
        "uncheck",
        "hover",
        "key",
        "scroll",
        "wait_for",
        "dialog",
        "click_at",
        "move_to",
        "mouse_down",
        "mouse_up",
        "wheel",
        "drag",
        "key_down",
        "key_up",
        "drop",
      ],
    },
    slowly: flag,
    url: text(1, 4000),
    ref,
    to: ref,
    x: { type: "number", minimum: 0, maximum: 20000 },
    y: { type: "number", minimum: 0, maximum: 20000 },
    toX: { type: "number", minimum: 0, maximum: 20000 },
    toY: { type: "number", minimum: 0, maximum: 20000 },
    deltaX: { type: "number", minimum: -5000, maximum: 5000 },
    deltaY: { type: "number", minimum: -5000, maximum: 5000 },
    locator: object({ role: text(1, 40), name: text(0, 200), index: whole(0, 200) }, [
      "role",
      "name",
    ]),
    text: text(0, 20000),
    values: { type: "array", minItems: 1, maxItems: 50, items: text(0, 500) },
    key: text(0, 16),
    modifiers: {
      type: "array",
      maxItems: 4,
      items: { type: "string", enum: ["Shift", "Control", "Alt", "Meta"] },
    },
    direction: { type: "string", enum: ["up", "down", "left", "right", "into_view"] },
    amount: { type: "number", minimum: 0.1, maximum: 10 },
    button: { type: "string", enum: ["left", "right"] },
    clickCount: whole(1, 2),
    submit: flag,
    textGone: text(0, 500),
    timeoutMs: whole(100, 20000),
    accept: flag,
  },
  ["action"],
);

const fieldValue: Schema = {
  anyOf: [
    text(0, 20000),
    { type: "number" },
    flag,
    { type: "array", minItems: 1, maxItems: 50, items: text(0, 500) },
  ],
};

const folder = text(1, 300);
const path = text(0, 1000);
const device = text(0, 100);

export const deviceToolSchemas: Record<string, Schema> = {
  "browser.request_user_action": page(
    {
      action: {
        type: "string",
        enum: ["sign_in", "account_confirmation", "challenge", "open_target", "review"],
      },
      reason: text(1, 1000),
    },
    ["action", "reason"],
  ),
  "browser.workspace.visual": page(),
  "browser.inspect": page({
    extensionId: { type: "string", pattern: "^([1-9][0-9]{0,19}|[a-p]{32})$" },
  }),
  "browser.visual": page({
    documentId,
    ref,
    fullPage: flag,
    scale: { type: "string", enum: ["css", "device"] },
    type: { type: "string", enum: ["png", "jpeg"] },
  }),
  "browser.navigate": page({
    url: text(0, 4096),
    history: { type: "string", enum: ["back", "forward", "reload"] },
  }),
  "browser.act": page({ goal: text(3, 2000), allowConsequential: flag }, ["goal"]),
  "browser.upload": page(
    {
      documentId,
      elementRef: text(1, 128),
      ref,
      attachmentId: text(1, 200),
      downloadId: text(1, 200),
      sourceScopeId: scopeId,
      path: text(1, 1000),
      drop: flag,
    },
    ["documentId"],
  ),
  "browser.downloads.list": page(),
  "browser.snapshot": page({ scopeRef: ref, maxChars: whole(2000, 60000) }),
  "browser.find": page({ query: text(1, 500), limit: whole(1, 20) }, ["query"]),
  "browser.console": page({
    level: { type: "string", enum: ["error", "warning", "info", "debug"] },
    clear: flag,
  }),
  "browser.network": page({
    request: whole(1, 100000000),
    filter: text(1, 500),
    includeStatic: flag,
    clear: flag,
  }),
  "browser.storage": page({
    store: { type: "string", enum: ["cookies", "local", "session"] },
    action: { type: "string", enum: ["list", "get", "set", "delete", "clear"] },
    name: text(1, 500),
    value: text(0, 8000),
    domain: text(1, 300),
    path: text(1, 1000),
    expires: { type: "number", minimum: 0 },
    httpOnly: flag,
    secure: flag,
    sameSite: { type: "string", enum: ["Lax", "Strict", "None"] },
  }),
  "browser.verify": page(
    {
      documentId,
      checks: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", open: true } },
    },
    ["checks"],
  ),
  "browser.highlight": page({
    documentId,
    ref,
    refs: { type: "array", minItems: 1, maxItems: 20, items: ref },
    label: text(1, 80),
    clear: flag,
  }),
  "browser.emulate": page({
    width: { type: "number", minimum: 200, maximum: 4000 },
    height: { type: "number", minimum: 200, maximum: 4000 },
    colorScheme: { type: "string", enum: ["light", "dark", "no-preference"] },
    media: { type: "string", enum: ["screen", "print"] },
    reset: flag,
  }),
  "browser.pdf": page({ path: text(1, 500) }),
  "browser.page_tools": page({
    action: { type: "string", enum: ["list", "call"] },
    name: text(1, 128),
    args: { type: "object", open: true },
    allowConsequential: flag,
  }),
  "browser.extract": page({ instruction: text(1, 4000), schema: { type: "object", open: true } }, [
    "instruction",
    "schema",
  ]),
  "browser.wait_for": page({
    seconds: { type: "number", minimum: 0.1, maximum: 30 },
    text: text(1, 500),
    textGone: text(1, 500),
    urlIncludes: text(1, 500),
    timeoutMs: whole(100, 20000),
  }),
  "browser.steps": page(
    {
      documentId,
      steps: { type: "array", minItems: 1, maxItems: 10, items: step },
      allowConsequential: flag,
      includeSnapshot: flag,
    },
    ["documentId", "steps"],
  ),
  "browser.skill": page(
    {
      documentId,
      skill: text(1, 40),
      action: text(1, 40),
      args: { type: "object", open: true },
      allowConsequential: flag,
      includeSnapshot: flag,
    },
    ["documentId", "skill", "action"],
  ),
  "browser.fill_form": page(
    {
      documentId,
      fields: {
        type: "array",
        minItems: 1,
        maxItems: 30,
        items: object({ ref, value: fieldValue }, ["ref", "value"]),
      },
      includeSnapshot: flag,
    },
    ["documentId", "fields"],
  ),
  "browser.run": object({ code: text(1, 20000), saveAs: text(1, 200) }, ["code"]),
  "folder.list": object({ folder, path }, ["folder"]),
  "folder.read": object({ folder, path }, ["folder", "path"]),
  "folder.send": object({ folder, path }, ["folder", "path"]),
  "shell.run": object({ command: text(1, 60000), timeout_seconds: whole(1, 600), device }, [
    "command",
  ]),
  "screen.open": object(
    {
      reason: text(3, 300),
      target: { type: "string", enum: ["new_tab", "window", "desktop"] },
      url: text(0, 2048),
    },
    ["reason"],
  ),
  "screen.look": object({ reason: text(3, 300) }, ["reason"]),
  "screen.close": object({ scopeId }, ["scopeId"]),
  "browser.tab.list": object({}),
  "browser.tab.use": object({ scopeId, reason: text(3, 300) }, ["scopeId", "reason"]),
};

function isType(value: unknown, type: NonNullable<Schema["type"]>): boolean {
  switch (type) {
    case "object":
      return !!value && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    default:
      return typeof value === type;
  }
}

export function matchesSchema(schema: Schema, value: unknown): boolean {
  if (schema.anyOf) return schema.anyOf.some((option) => matchesSchema(option, value));
  if (schema.type && !isType(value, schema.type)) return false;
  if (schema.enum && !schema.enum.includes(value as string)) return false;
  if (typeof value === "string") {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) return false;
    if (schema.maxLength !== undefined && length > schema.maxLength) return false;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.items && !value.every((item) => matchesSchema(schema.items!, item))) return false;
  }
  if (schema.type === "object" && !schema.open) {
    const record = value as Record<string, unknown>;
    const known = schema.properties ?? {};
    if (schema.required?.some((name) => record[name] === undefined)) return false;
    for (const [name, item] of Object.entries(record)) {
      if (!known[name] || !matchesSchema(known[name], item)) return false;
    }
  }
  return true;
}
