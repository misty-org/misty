// Builtins Midscene imports for Node-only features the desktop never runs.
const unavailable = (name: string) => () => {
  throw new Error(`${name} is unavailable in the Misty app`);
};
export const execFile = unavailable("child_process.execFile");
export const createServer = unavailable("net.createServer");
export class AsyncLocalStorage<T> {
  private value: T | undefined;
  getStore() {
    return this.value;
  }
  run<R>(value: T, callback: () => R) {
    const previous = this.value;
    this.value = value;
    try {
      return callback();
    } finally {
      this.value = previous;
    }
  }
}
export class StringDecoder {
  private decoder = new TextDecoder();
  write(value: Uint8Array) {
    return this.decoder.decode(value, { stream: true });
  }
  end(value?: Uint8Array) {
    return value ? this.decoder.decode(value) : "";
  }
}
export function assert(value: unknown, message?: string): asserts value {
  if (!value) throw new Error(message ?? "Assertion failed");
}
export default assert;
