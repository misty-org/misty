/**
 * A model's name as the engine gives it. Misty doesn't make names up or rewrite them: a row
 * the engine named ("Opus 5.5", "GPT-5.6-Luna") shows that name, and an id the engine names
 * nowhere shows as the engine wrote it. Ids seen in an engine's catalog are remembered with
 * their names, so a reply's footer, which only has the id the engine served, names it the same
 * way the picker does.
 */
const known = new Map<string, string>();

/** Keeps the names an engine's catalog gives its models, for ids shown elsewhere. */
export function rememberModelNames(models: ReadonlyArray<{ id: string; label: string }>) {
  for (const model of models)
    if (model.label && model.label !== model.id) known.set(model.id, model.label);
}

/** The engine's name for a model: the one given, else the one its catalog gave, else its id. */
export function modelName(label: string, id: string): string {
  const given = label.trim();
  if (given && given !== id) return given;
  return known.get(id) ?? (given || id);
}
