import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."); const dist=path.join(repo,"dist/plugins"); const artifacts=path.join(repo,"artifacts"); const cache=process.env.MISTY_TOOL_SOURCE_DIR || path.join(repo,"tool-cache");
const index=JSON.parse(await readFile(path.join(repo,"catalog/index.json"),"utf8")); const platforms=(process.env.TARGET_PLATFORMS || "macos-aarch64,macos-x86_64,windows-x86_64,linux-x86_64").split(",").filter(Boolean);
await rm(artifacts,{recursive:true,force:true}); await mkdir(path.join(artifacts,"catalog"),{recursive:true});
for(const entry of index){for(const target of platforms){const source=path.join(dist,entry.id);const stage=path.join(artifacts,"stage",entry.id);await rm(stage,{recursive:true,force:true});await cp(source,stage,{recursive:true});const manifestPath=path.join(stage,"manifest.json");const manifest=JSON.parse(await readFile(manifestPath,"utf8"));const [platform,architecture]=target.split(/-(?=[^-]+$)/);const selected=(manifest.tools??[]).filter(tool=>tool.platform===platform&&tool.architecture===architecture);manifest.tools=selected;
for(const tool of selected){const executable=path.basename(tool.path);const cached=path.join(cache,target,executable);if(!(await stat(cached).catch(()=>null)))throw new Error(`Missing verified tool-cache/${target}/${executable}`);const destination=path.join(stage,tool.path);await mkdir(path.dirname(destination),{recursive:true});await cp(cached,destination);if(platform!=="windows")execFileSync("chmod",["755",destination]);tool.sha256=await digest(destination);}
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+"\n");const zipName=`${entry.id}-${target}.zip`;const zipPath=path.join(artifacts,zipName);if(process.platform==="win32")execFileSync("7z",["a","-tzip","-mx=9",zipPath,entry.id],{cwd:path.join(artifacts,"stage")});else execFileSync("zip",["-X","-q","-r",zipPath,entry.id],{cwd:path.join(artifacts,"stage")});const sha256=await digest(zipPath);await writeFile(`${zipPath}.sha256`,`${sha256}  ${zipName}\n`);const catalog=JSON.parse(await readFile(path.join(repo,`catalog/${entry.id}.json`),"utf8"));const artifact=catalog.install.artifacts.find(item=>item.platform===target);if(artifact)artifact.sha256=sha256;await writeFile(path.join(artifacts,"catalog",`${entry.id}-${target}.json`),JSON.stringify(catalog,null,2)+"\n");}}
await rm(path.join(artifacts,"stage"),{recursive:true,force:true});
async function digest(file){return createHash("sha256").update(await readFile(file)).digest("hex")}
