import type { MistyAppSDK, MistyFileHandle } from "@misty/sdk";
export type ConvertRow = { source: string; output?: string; bytes?: number; error?: string };
function pause(signal: AbortSignal) {
  return new Promise<void>((resolve,reject) => {
    const abort = () => { clearTimeout(timer); reject(new Error("Conversion cancelled.")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort",abort); resolve(); },250);
    signal.addEventListener("abort",abort,{once:true});
    if (signal.aborted) abort();
  });
}
export async function convertMedia(sdk: MistyAppSDK, files: readonly MistyFileHandle[], directory: string, format: string, quality: "small"|"balanced"|"high", signal: AbortSignal, progress: (rows: ConvertRow[]) => void): Promise<ConvertRow[]> {
  if (!files.length || files.length > 64) throw new Error("Choose between one and 64 files.");
  const rows: ConvertRow[] = [];
  for (const file of files) {
    signal.throwIfAborted();
    let jobId = ""; let draft = "";
    try {
      const name = file.name.replace(/\.[^.]+$/, "").slice(0,125) + `_converted.${format}`;
      jobId = (await sdk.media.convertStart({ handle:file.handle, directory, name, format, quality })).jobId;
      for (;;) {
        signal.throwIfAborted();
        const status = await sdk.media.convertStatus(jobId);
        signal.throwIfAborted();
        if (status.status === "completed") break;
        if (status.status !== "running") throw new Error(status.message);
        await pause(signal);
      }
      const output = await sdk.media.convertCollect(jobId);
      draft = output.handle;
      signal.throwIfAborted();
      const saved = await sdk.files.commitCopy(draft);
      draft = "";
      rows.push({source:file.name,output:saved.name,bytes:saved.bytes});
    } catch (error) {
      signal.throwIfAborted();
      rows.push({source:file.name,error:String(error)});
    } finally {
      if (jobId) {
        if (signal.aborted) await sdk.media.convertCancel(jobId).catch(() => undefined);
        await sdk.media.convertClose(jobId).catch(() => undefined);
      }
      if (draft) await sdk.files.discardCopy(draft).catch(() => undefined);
    }
    progress([...rows]);
  }
  return rows;
}
