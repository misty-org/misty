import { spawnSync } from "node:child_process";
import { copyFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const targets = {
  "macos-aarch64": "aarch64-apple-darwin",
  "macos-x86_64": "x86_64-apple-darwin",
};
const platform = process.argv[2] || (process.platform === "darwin" ? `macos-${process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch}` : "");
if (!targets[platform]) throw new Error("Choose macos-aarch64 or macos-x86_64; other devices do not execute this service.");
const selectedService=process.argv[3];
const services=selectedService ? [selectedService] : ["document-processing","file-search","file-operations","backup-archive"];
if (services.some(service=>!["document-processing","file-search","terminal","code-tools","peer-transport","file-operations","backup-archive"].includes(service))) throw new Error("Unknown native service.");
for (const service of services) {
const crate = path.join(root, "native-services",service);
const built = spawnSync("cargo", ["build", "--locked", "--release", "--target", targets[platform], "--manifest-path", path.join(crate, "Cargo.toml")], { cwd: crate, stdio: "inherit" });
if (built.error) throw built.error;
if (built.status !== 0) process.exit(built.status ?? 1);
const output = path.join(root, ".build/native-services", service, platform);
await mkdir(output, { recursive: true });
const staging = path.join(output, `worker.${process.pid}.tmp`);
await copyFile(path.join(crate, "target", targets[platform], `release/misty-${service}`), staging);
await rename(staging, path.join(output, "worker"));
console.log(`Built ${service} for ${platform}.`);
}
