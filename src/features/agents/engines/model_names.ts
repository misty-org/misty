const known = new Map<string, string>();

export function rememberModelNames(models: ReadonlyArray<{ id: string; label: string }>) {
  for (const model of models)
    if (model.label && model.label !== model.id) known.set(model.id, model.label);
}

export function modelName(label: string, id: string): string {
  const given = label.trim();
  if (given && given !== id) return given;
  return known.get(id) ?? (given || id);
}
