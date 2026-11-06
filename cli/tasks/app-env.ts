// Only VITE_ names reach the renderer, so private settings stay out of the bundle.
export function publicAppEnv(env) {
  return Object.fromEntries(Object.entries(env)
    .filter(([key, value]) => key.startsWith("VITE_") && value !== undefined)
    .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]));
}
