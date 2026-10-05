// See ./fs: the desktop webview never writes Midscene reports or caches.
const ignore = async () => undefined;
const unavailable = (name: string) => async () => {
  throw new Error(`${name} is unavailable in the Misty app`);
};
export const writeFile = ignore;
export const appendFile = ignore;
export const mkdir = ignore;
export const rename = ignore;
export const unlink = ignore;
export const rm = ignore;
export const copyFile = ignore;
export const cp = ignore;
export const mkdtemp = unavailable("fs.mkdtemp");
export const readFile = unavailable("fs.readFile");
export const stat = unavailable("fs.stat");
export const open = unavailable("fs.open");
export default {
  writeFile, appendFile, mkdir, rename, unlink, rm, copyFile, cp, mkdtemp, readFile, stat, open,
};
