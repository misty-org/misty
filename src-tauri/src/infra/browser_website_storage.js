// Executed only by the native sync host in the website's own origin. No Misty
// renderer IPC, console output, or extra browser storage is used for transport.
const request = __MISTY_STORAGE_REQUEST__;
if (location.origin !== request.origin || !/^https?:$/.test(location.protocol)) throw new Error('origin_changed');
// Only sign-in storage syncs. Everything else on the site is never read, and
// never overwritten or deleted by a restore.
const scope = request.scope;
const signinKey = (key, value) => typeof value === 'string' && value.length <= scope.max_value &&
  scope.keys.some(marker => key.toLowerCase().includes(marker));
const signinDatabase = name => scope.databases.includes(name);
const limit = 8 * 1024 * 1024;
let total = 0;
const budget = (size) => { total += size; if (total > limit) throw new Error('storage_too_large'); };
const encode = async (value, parents = new Set()) => {
  if (value === undefined) return ['undefined'];
  if (typeof value === 'bigint') return ['bigint', String(value)];
  if (typeof value === 'number' && !Number.isFinite(value)) return ['number', String(value)];
  if (Object.is(value, -0)) return ['number', '-0'];
  if (value === null || typeof value !== 'object') { budget(typeof value === 'string' ? value.length * 2 : 16); return ['value', value]; }
  if (parents.has(value)) throw new Error('cyclic_storage_value');
  const next = new Set(parents); next.add(value);
  if (value instanceof Date) return ['date', value.getTime()];
  if (value instanceof RegExp) return ['regexp', value.source, value.flags];
  const bytes = (buffer) => { budget(buffer.byteLength * 2); return Array.from(new Uint8Array(buffer)); };
  if (value instanceof ArrayBuffer) return ['buffer', bytes(value)];
  if (ArrayBuffer.isView(value)) return ['typed', value.constructor.name, bytes(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))];
  if (value instanceof Blob) return ['blob', value.type, bytes(await value.arrayBuffer()), value instanceof File ? [value.name, value.lastModified] : null];
  if (value instanceof Map) return ['map', await Promise.all([...value].map(async ([k, v]) => [await encode(k, next), await encode(v, next)]))];
  if (value instanceof Set) return ['set', await Promise.all([...value].map(v => encode(v, next)))];
  if (Array.isArray(value)) return ['array', await Promise.all(value.map(v => encode(v, next)))];
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('unsupported_storage_value');
  return ['object', await Promise.all(Object.keys(value).sort().map(async k => { budget(k.length * 2); return [k, await encode(value[k], next)]; }))];
};
const decode = (value) => {
  const [kind, data, extra, file] = value;
  switch (kind) {
    case 'undefined': return undefined;
    case 'value': return data;
    case 'bigint': return BigInt(data);
    case 'number': return Number(data);
    case 'date': return new Date(data);
    case 'regexp': return new RegExp(data, extra);
    case 'buffer': return new Uint8Array(data).buffer;
    case 'typed': {
      const types = { Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView };
      if (!Object.hasOwn(types, data)) throw new Error('unsupported_storage_type');
      return new types[data](new Uint8Array(extra).buffer);
    }
    case 'blob': return file ? new File([new Uint8Array(extra)], file[0], { type: data, lastModified: file[1] }) : new Blob([new Uint8Array(extra)], { type: data });
    case 'map': return new Map(data.map(([k, v]) => [decode(k), decode(v)]));
    case 'set': return new Set(data.map(decode));
    case 'array': return data.map(decode);
    case 'object': return Object.fromEntries(data.map(([k, v]) => [k, decode(v)]));
    default: throw new Error('unsupported_storage_type');
  }
};
const completed = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = resolve;
  transaction.onabort = transaction.onerror = () => reject(new Error('database_transaction_failed'));
});
const operation = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = req.onblocked = () => reject(new Error('database_unavailable'));
});
const entries = (storage) => Object.fromEntries(Object.keys(storage).sort()
  .map(key => [key, storage.getItem(key)]).filter(([key, value]) => signinKey(key, value)));
const writeEntries = (storage, values) => {
  for (const key of Object.keys(entries(storage))) if (!Object.hasOwn(values, key)) storage.removeItem(key);
  for (const [key, value] of Object.entries(values)) if (signinKey(key, value) && storage.getItem(key) !== value) storage.setItem(key, value);
};
// Why a database or area was skipped. Only these fixed reasons leave the page.
const reasonOf = (error) => ({ unsupported_storage_value: 'unsupported_values', cyclic_storage_value: 'unsupported_values', storage_too_large: 'too_large' })[error?.message] ?? 'unreadable';
// A database that cannot be exported is skipped whole (its rows depend on each
// other), recorded in `skipped`, and never deleted by a later import.
const exportDatabases = async (skipped = []) => {
  if (!indexedDB.databases) throw new Error('database_enumeration_unavailable');
  const databases = [];
  const names = (await indexedDB.databases()).filter(v => typeof v.name === 'string' && signinDatabase(v.name)).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const info of names.slice(256)) skipped.push({ name: info.name, reason: 'sync_limit' });
  for (const info of names.slice(0, 256)) {
    const before = total;
    try { databases.push(await exportDatabase(info.name)); }
    catch (error) { total = before; skipped.push({ name: info.name, reason: reasonOf(error) }); }
  }
  return { codec_version: 1, databases };
};
const exportDatabase = async (name) => {
  const db = await operation(indexedDB.open(name));
  try {
    const storeNames = Array.from(db.objectStoreNames).sort();
    const stores = [];
    if (storeNames.length) {
      const transaction = db.transaction(storeNames, 'readonly');
      const done = completed(transaction);
      const reads = storeNames.map(name => {
        const store = transaction.objectStore(name);
        const schema = { name, keyPath: store.keyPath, autoIncrement: store.autoIncrement,
          indexes: Array.from(store.indexNames).sort().map(name => { const index = store.index(name); return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }; }) };
        const rows = [];
        const cursor = store.openCursor();
        cursor.onsuccess = () => { const next = cursor.result; if (next) { budget(64); rows.push([next.key, next.value]); next.continue(); } };
        return { schema, rows };
      });
      await done;
      for (const { schema, rows } of reads) stores.push({ ...schema, records: await Promise.all(rows.map(async ([key, value]) => ({ key: await encode(key), value: await encode(value) }))) });
    }
    return { name: db.name, version: db.version, stores };
  } finally { db.close(); }
};
const stable = value => JSON.stringify(value, (_, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
// `hold` names local databases that could not sync; their synced copies are
// stand-ins and must not overwrite them.
const importDatabases = async (target, hold) => {
  if (target.codec_version !== 1) throw new Error('unsupported_database_codec');
  const current = await exportDatabases();
  if (stable(current) === stable(target)) return;
  const desired = new Map(target.databases.map(db => [db.name, db]));
  for (const old of current.databases) if (!desired.has(old.name)) await operation(indexedDB.deleteDatabase(old.name));
  for (const spec of target.databases) {
    if (hold.has(spec.name) || !signinDatabase(spec.name)) continue;
    if (stable(current.databases.find(db => db.name === spec.name)) === stable(spec)) continue;
    // Decode before removing the previous database. Native keeps the encrypted
    // previous profile snapshot until the complete import has been verified.
    const stores = spec.stores.map(store => ({ ...store, values: store.records.map(row => ({ key: decode(row.key), value: decode(row.value) })) }));
    await operation(indexedDB.deleteDatabase(spec.name));
    const open = indexedDB.open(spec.name, spec.version);
    open.onupgradeneeded = () => {
      for (const spec of stores) {
        const store = open.result.createObjectStore(spec.name, { keyPath: spec.keyPath, autoIncrement: spec.autoIncrement });
        for (const index of spec.indexes) store.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
      }
    };
    const db = await operation(open);
    try {
      if (stores.length) {
        const transaction = db.transaction(stores.map(store => store.name), 'readwrite');
        const done = completed(transaction);
        for (const spec of stores) for (const row of spec.values) {
          const store = transaction.objectStore(spec.name);
          if (spec.keyPath === null) store.put(row.value, row.key); else store.put(row.value);
        }
        await done;
      }
    } finally { db.close(); }
  }
};
if (request.write) {
  if (request.write.local !== undefined) writeEntries(localStorage, request.write.local);
  if (request.write.session !== undefined) writeEntries(sessionStorage, request.write.session);
  if (request.write.indexed !== undefined) await importDatabases(request.write.indexed, new Set(request.write.hold ?? []));
}
// Periodic capture names the areas it needs (a second tab of an origin needs
// only its own session storage) and the stamps of what it already holds. An
// area whose stamp still matches is reported unchanged instead of re-exported.
const read = request.read ?? { local: true, session: true, indexed: true };
const known = request.known ?? {};
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
// IndexedDB has no change notification. Its database list and the origin's
// storage usage change with most writes; native re-exports on a bounded
// schedule for writes that change neither.
const indexedStamp = async () => {
  if (!indexedDB.databases || !navigator.storage?.estimate) return null;
  const [all, estimate] = await Promise.all([indexedDB.databases(), navigator.storage.estimate()]);
  const list = all.filter(db => typeof db.name === 'string' && signinDatabase(db.name));
  // Most sites have no sign-in database: a stable stamp, so nothing is exported.
  if (!list.length) return '[]';
  const usage = estimate.usageDetails?.indexedDB ?? estimate.usage;
  if (typeof usage !== 'number') return null;
  return JSON.stringify([list.map(db => [db.name, db.version ?? null]).sort(), usage]);
};
// Anything that cannot be exported is skipped and reported by kind and reason;
// native keeps its last synced copy instead of treating it as deleted.
const skipped = [];
const skippedDatabases = [];
const result = { origin: location.origin, local: null, session: null, indexed: null, skipped, skipped_databases: [], unchanged: [], stamps: {} };
for (const [field, storage] of [['local', localStorage], ['session', sessionStorage]]) {
  if (!read[field]) continue;
  const values = entries(storage);
  const stamp = digest(JSON.stringify(values));
  result.stamps[field] = stamp;
  if (known[field] === stamp) result.unchanged.push(field);
  else result[field] = values;
}
if (read.indexed) {
  let stamp = null;
  try { stamp = await indexedStamp(); } catch { stamp = null; }
  result.stamps.indexed = stamp;
  if (stamp !== null && known.indexed === stamp) result.unchanged.push('indexed');
  else {
    try {
      result.indexed = await exportDatabases(skippedDatabases);
      for (const { reason } of skippedDatabases) skipped.push({ kind: 'indexed_db', reason, count: 1 });
      result.skipped_databases = skippedDatabases.map(db => db.name);
    } catch (error) {
      skipped.push({ kind: 'indexed_db', reason: reasonOf(error), count: 1 });
    }
  }
}
for (const [field, kind] of [['indexed', 'indexed_db'], ['local', 'local_storage'], ['session', 'session_storage']]) {
  if (JSON.stringify(result).length <= limit) break;
  if (result[field] === null) continue;
  const count = field === 'indexed' ? result.indexed.databases.length : Object.keys(result[field]).length;
  result[field] = null;
  if (field === 'indexed') result.skipped_databases = [];
  skipped.push({ kind, reason: 'too_large', count });
}
if (result.origin !== request.origin) throw new Error('origin_changed');
const serialized = JSON.stringify(result);
if (serialized.length > limit) throw new Error('storage_too_large');
return serialized;