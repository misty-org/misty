import { expect, it, vi } from "vitest";
import type { MistyAppSDK } from "@misty/sdk";
import { convertMedia } from "./convertMedia";
function fixture() {
  const media={ convertStart:vi.fn(async()=>({jobId:"job"})),convertStatus:vi.fn(async()=>({status:"completed",message:"Ready"})),convertCollect:vi.fn(async()=>({handle:"draft",name:"copy.mp3",bytes:10})),convertCancel:vi.fn(async()=>undefined),convertClose:vi.fn(async()=>undefined) };
  const files={commitCopy:vi.fn(async()=>({name:"song_converted.mp3",bytes:10})),discardCopy:vi.fn(async()=>undefined)};
  return {media,files,sdk:{media,files} as unknown as MistyAppSDK};
}
const chosen=[{handle:"input",name:"song.wav",bytes:100}];
it("requests only fixed conversion options and saves the collected draft",async()=>{
  const {sdk,media,files}=fixture();
  const rows=await convertMedia(sdk,chosen,"folder","mp3","balanced",new AbortController().signal,vi.fn());
  expect(media.convertStart).toHaveBeenCalledWith({handle:"input",directory:"folder",name:"song_converted.mp3",format:"mp3",quality:"balanced"});
  expect(files.commitCopy).toHaveBeenCalledWith("draft"); expect(media.convertClose).toHaveBeenCalledWith("job");
  expect(rows).toEqual([{source:"song.wav",output:"song_converted.mp3",bytes:10}]);
});
it("cancel after collection discards the draft without saving",async()=>{
  const {sdk,media,files}=fixture();const abort=new AbortController();
  media.convertCollect.mockImplementationOnce(async()=>{abort.abort();return {handle:"draft",name:"copy.mp3",bytes:10};});
  await expect(convertMedia(sdk,chosen,"folder","mp3","balanced",abort.signal,vi.fn())).rejects.toThrow();
  expect(files.commitCopy).not.toHaveBeenCalled();expect(files.discardCopy).toHaveBeenCalledWith("draft");expect(media.convertCancel).toHaveBeenCalledWith("job");
});
it("cancel during processing stops and closes the native job",async()=>{
  const {sdk,media,files}=fixture();const abort=new AbortController();
  media.convertStatus.mockImplementationOnce(async()=>{abort.abort();return {status:"running",message:"Working"};});
  await expect(convertMedia(sdk,chosen,"folder","mp3","balanced",abort.signal,vi.fn())).rejects.toThrow();
  expect(media.convertCancel).toHaveBeenCalledWith("job");expect(media.convertClose).toHaveBeenCalledWith("job");expect(files.commitCopy).not.toHaveBeenCalled();
});
it("denied collection never saves and shows the native permission error",async()=>{
  const {sdk,media,files}=fixture();media.convertCollect.mockRejectedValueOnce(new Error("Permission revoked"));
  const rows=await convertMedia(sdk,chosen,"folder","mp3","balanced",new AbortController().signal,vi.fn());
  expect(rows[0].error).toContain("Permission revoked");expect(files.commitCopy).not.toHaveBeenCalled();
});
