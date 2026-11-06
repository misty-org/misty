// Run only from native code, in Misty's own script world on the website's origin, so a site can
// neither observe nor patch it. No Misty renderer IPC, console output, or extra browser storage.
const request = JSON.parse(__MISTY_STORAGE_REQUEST__);
if (location.origin !== request.origin || !/^https?:$/.test(location.protocol)) throw new Error('origin_changed');
const LIMIT = 8 * 1024 * 1024;
// Storage holds UTF-16, and JSON can't carry a lone surrogate to native code: such text travels
// as its code units, behind a mark no real value starts with.
const MARK = '\u0000misty-utf16:';
const pack = (text) => {
  if (!text.startsWith(MARK) && text.isWellFormed()) return text;
  let units = '';
  for (let i = 0; i < text.length; i++) units += text.charCodeAt(i).toString(16).padStart(4, '0');
  return MARK + units;
};
const unpack = (text) => {
  if (!text.startsWith(MARK)) return text;
  const units = text.slice(MARK.length);
  let out = '';
  for (let i = 0; i < units.length; i += 4) out += String.fromCharCode(parseInt(units.slice(i, i + 4), 16));
  return out;
};
const read = () => {
  const entries = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    entries.push([pack(key), pack(localStorage.getItem(key))]);
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return Object.fromEntries(entries);
};
const digest = (text) => {
  let h1 = 0xdeadbeef ^ text.length, h2 = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${text.length}:${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}`;
};
// Replaces the whole origin. A value the browser refuses is reported, and native code then
// finds the difference on reading back and puts the old data back.
let writeFailed = false;
if (request.write) {
  const target = new Map(Object.entries(request.write).map(([key, value]) => [unpack(key), unpack(value)]));
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!target.has(key)) localStorage.removeItem(key);
    }
    for (const [key, value] of target) if (localStorage.getItem(key) !== value) localStorage.setItem(key, value);
  } catch { writeFailed = true; }
}
const items = read();
const text = JSON.stringify(items);
const stamp = digest(text);
const result = { origin: location.origin, stamp, items: null, unchanged: false, too_large: false, write_failed: writeFailed };
if (!request.write && request.known === stamp) result.unchanged = true;
else if (new TextEncoder().encode(text).length > LIMIT) result.too_large = true;
else result.items = items;
if (location.origin !== request.origin) throw new Error('origin_changed');
return JSON.stringify(result);
