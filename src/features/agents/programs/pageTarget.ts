const ref = /\[ref=(e\d+)\]/;

type Operate = (
  operation: string,
  scopeId: string,
  input: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/** A step's target: a ref, a locator, or words looked up with find. */
export async function pageTarget(
  operate: Operate,
  scopeId: string,
  target: unknown,
): Promise<Record<string, unknown>> {
  if (target === undefined || target === null) return {};
  if (typeof target === "string" && /^e\d+$/.test(target)) return { ref: target };
  // A whole line copied from read() or find() ('button "Search" [ref=e8]') names its ref.
  const copied = typeof target === "string" ? ref.exec(target)?.[1] : undefined;
  if (copied) return { ref: copied };
  if (typeof target === "object" && typeof (target as { role?: unknown }).role === "string") {
    const { role, name, index } = target as { role: string; name?: unknown; index?: unknown };
    return {
      locator: {
        role,
        name: String(name ?? ""),
        ...(typeof index === "number" ? { index } : {}),
      },
    };
  }
  // The object forms a model writes: { ref: "e12" }, or words under text, query, words, name or label.
  const given = target as {
    ref?: unknown;
    text?: unknown;
    query?: unknown;
    words?: unknown;
    name?: unknown;
    label?: unknown;
  };
  if (typeof target === "object" && typeof given.ref === "string" && /^e\d+$/.test(given.ref))
    return { ref: given.ref };
  const query =
    typeof target === "string"
      ? target
      : String(given.text ?? given.query ?? given.words ?? given.name ?? given.label ?? "");
  const found = await operate("browser.find", scopeId, { query, limit: 3 });
  const first = (found.matches as string[] | undefined)
    ?.map((line) => ref.exec(line)?.[1])
    .find(Boolean);
  if (!first)
    throw new Error(
      `Nothing on ${String(found.url ?? "the page")} matches "${query}". Read the page (tab.read()) and use a ref.`,
    );
  return { ref: first };
}
