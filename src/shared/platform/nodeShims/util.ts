// The few node:util helpers Midscene's planner path uses.
export const promisify =
  <T>(fn: (...args: unknown[]) => void) =>
  (...args: unknown[]) =>
    new Promise<T>((resolve, reject) =>
      fn(...args, (error: unknown, value: T) => (error ? reject(error) : resolve(value))),
    );
export const isDeepStrictEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const inspect = (value: unknown) => {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
};
export const format = (...values: unknown[]) => values.map(inspect).join(" ");
export default { promisify, isDeepStrictEqual, inspect, format };
