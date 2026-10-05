// Midscene's report and cache helpers import node:fs. In the desktop webview
// nothing is written to disk: writes are dropped and reads fail.
const unavailable = (name: string) => () => {
  throw new Error(`${name} is unavailable in the Misty app`);
};
const ignore = () => undefined;
export const existsSync = () => false;
export const mkdirSync = ignore;
export const writeFileSync = ignore;
export const appendFileSync = ignore;
export const copyFileSync = ignore;
export const renameSync = ignore;
export const rmSync = ignore;
export const unlinkSync = ignore;
export const truncateSync = ignore;
export const closeSync = ignore;
export const openSync = unavailable("fs.openSync");
export const readSync = unavailable("fs.readSync");
export const mkdtempSync = unavailable("fs.mkdtempSync");
export const readFileSync = unavailable("fs.readFileSync");
export const readdirSync = () => [];
export const statSync = unavailable("fs.statSync");
export const createReadStream = unavailable("fs.createReadStream");
export const createWriteStream = unavailable("fs.createWriteStream");
export const promises = {};
export default {
  existsSync, mkdirSync, writeFileSync, appendFileSync, copyFileSync, renameSync, rmSync,
  truncateSync, closeSync, openSync, readSync,
  unlinkSync, mkdtempSync, readFileSync, readdirSync, statSync, createReadStream,
  createWriteStream, promises,
};
