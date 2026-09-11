import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { packageNativeServices, nativeServicesForApp } from "./package-native-services.mjs";

test("signed services bind bytes to an app release and require release architectures", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "misty-services-"));
  const {privateKey, publicKey} = generateKeyPairSync("ed25519");
  try {
    const app = {id:"files",version:"1.2.3"};
    assert.deepEqual(await packageNativeServices(root, {id:"social"}, privateKey, "test"), []);
    await assert.rejects(packageNativeServices(root, app, privateKey, "test"), /Build/);
    const dir = path.join(root,".build/native-services/document-processing/macos-aarch64");
    await mkdir(dir,{recursive:true});
    await writeFile(path.join(dir,"worker"), "executable fixture");
    await assert.rejects(packageNativeServices(root, app, privateKey, "test"), /file-search/);
    const searchDir=path.join(root,".build/native-services/file-search/macos-aarch64");
    await mkdir(searchDir,{recursive:true});await writeFile(path.join(searchDir,"worker"),"search executable");
    await assert.rejects(packageNativeServices(root, app, privateKey, "test"), /peer-transport/);
    const peerDir=path.join(root,".build/native-services/peer-transport/macos-aarch64");
    await mkdir(peerDir,{recursive:true});await writeFile(path.join(peerDir,"worker"),"peer executable");
    await assert.rejects(packageNativeServices(root, app, privateKey, "test"), /file-operations/);
    const operationsDir=path.join(root,".build/native-services/file-operations/macos-aarch64");
    await mkdir(operationsDir,{recursive:true}); await writeFile(path.join(operationsDir,"worker"),"file operations executable");
    const files = await packageNativeServices(root, app, privateKey, "test");
    assert.equal(files.length,8);
    const envelope = JSON.parse(files[1].data);
    const payload = JSON.parse(envelope.payload);
    assert.equal(payload.appId,"files");
    assert.equal(payload.appVersion,"1.2.3");
    assert.equal(payload.platform,"macos-aarch64");
    assert.equal(payload.bytes,files[0].data.length);
    assert.ok(verify(null, Buffer.from(`misty-native-service-v1\n${envelope.payload}`), publicKey, Buffer.from(envelope.signature,"base64")));
    const searchEnvelope=JSON.parse(files[3].data);
    const searchPayload=JSON.parse(searchEnvelope.payload);
    assert.equal(searchPayload.service,"file-search");assert.equal(searchPayload.protocol,1);
    assert.ok(verify(null,Buffer.from(`misty-native-service-v1\n${searchEnvelope.payload}`),publicKey,Buffer.from(searchEnvelope.signature,"base64")));
    const peerEnvelope=JSON.parse(files[5].data);
    const peerPayload=JSON.parse(peerEnvelope.payload);
    assert.equal(peerPayload.service,"peer-transport");assert.equal(peerPayload.protocol,2);
    assert.equal(peerPayload.appId,"files");assert.equal(peerPayload.appVersion,"1.2.3");
    assert.ok(verify(null,Buffer.from(`misty-native-service-v1\n${peerEnvelope.payload}`),publicKey,Buffer.from(peerEnvelope.signature,"base64")));
    const library=await packageNativeServices(root,{id:"library",version:"1"},privateKey,"test");
    assert.equal(library.length,2);
    assert.ok(library.every(file=>!file.name.includes("file-search") && !file.name.includes("peer-transport")));
    await assert.rejects(packageNativeServices(root, app, privateKey, "test",{release:true}), /macos-x86_64/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

for (const [appId, service] of [["terminal", "terminal"], ["code", "code-tools"], ["backups", "backup-archive"], ["storage_report", "file-operations"]])
test(`${appId} carries only its own verified service and requires both release architectures`, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "misty-terminal-package-"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const app = { id: appId, version: "1.1.1" };
  try {
    for (const platform of ["macos-aarch64", "macos-x86_64"]) {
      for (const [service] of nativeServicesForApp(appId)) {
      const directory = path.join(root, `.build/native-services/${service}`, platform);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "worker"), `terminal-${platform}`);
      }
      if (platform === "macos-aarch64")
        await assert.rejects(packageNativeServices(root, app, privateKey, "test", { release: true }), /macos-x86_64/);
    }
    const files = await packageNativeServices(root, app, privateKey, "test", { release: true });
    assert.equal(files.length, 4 * nativeServicesForApp(appId).length);
    assert.ok(files.every(file => nativeServicesForApp(appId).some(([service]) => file.name.startsWith(`${appId}/native/${service}/`))));
    for (const file of files.filter(file => file.name.endsWith("service.json"))) {
      const envelope = JSON.parse(file.data);
      const payload = JSON.parse(envelope.payload);
      assert.equal(payload.appId, appId);
      assert.equal(payload.appVersion, "1.1.1");
      assert.ok(nativeServicesForApp(appId).some(([service]) => service === payload.service));
      assert.equal(payload.protocol, 1);
      assert.ok(verify(null, Buffer.from(`misty-native-service-v1\n${envelope.payload}`), publicKey, Buffer.from(envelope.signature, "base64")));
    }
    assert.deepEqual(await packageNativeServices(root, { id: "social" }, privateKey, "test"), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
