// Midscene hashes cache keys; a stable non-cryptographic digest is enough here.
export function createHash() {
  let input = "";
  const hash = {
    update(value: string | Uint8Array) {
      input += typeof value === "string" ? value : new TextDecoder().decode(value);
      return hash;
    },
    digest() {
      let a = 0x811c9dc5,
        b = 0x01000193;
      for (let i = 0; i < input.length; i++) {
        a = Math.imul(a ^ input.charCodeAt(i), 0x01000193);
        b = Math.imul(b ^ input.charCodeAt(input.length - 1 - i), 0x811c9dc5);
      }
      return ((a >>> 0).toString(16) + (b >>> 0).toString(16)).padStart(16, "0");
    },
  };
  return hash;
}
export default { createHash };
