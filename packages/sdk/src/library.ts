import {mistyLibraryContracts,type MistyLibraryOperation,type MistyLibraryReadOperation,type MistyLibraryUpload} from "@misty/contracts";
import type {MistyCall} from "./transport.js";
export function createLibrarySDK(call:MistyCall) {
 return Object.freeze({
  async copyFiles(files:Array<{name:string;bytes:ArrayBuffer}>) {const c=mistyLibraryContracts["library.copyFiles"];return c.result.parse(await call("library.copyFiles",c.params.parse({files})));},
  async perform(operation:MistyLibraryOperation,args:unknown[]) {const c=mistyLibraryContracts["library.perform"];return c.result.parse(await call("library.perform",c.params.parse({operation,args})));},
  async read(operation:MistyLibraryReadOperation,args:unknown[]) {const c=mistyLibraryContracts["library.read"];return c.result.parse(await call("library.read",c.params.parse({operation,args})));},
  async upload(input:MistyLibraryUpload) {const c=mistyLibraryContracts["library.upload"];return c.result.parse(await call("library.upload",c.params.parse(input)));},
 });
}
export type MistyLibrarySDK=ReturnType<typeof createLibrarySDK>;
