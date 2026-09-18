import { useEffect, useRef, useState } from "react";
import { Ban, FolderOpen, Wand2 } from "lucide-react";
import { ActionButton, Field, StatusLine } from "../../shared/pluginChrome";
import { connectMistyApp, type MistyAppSDK, type MistyFileHandle } from "@misty/sdk";
import { convertMedia, type ConvertRow } from "./convertMedia";

type MediaKind = "image" | "audio" | "video" | "unknown";
const presets: Record<Exclude<MediaKind, "unknown">, string[]> = {
  image: ["png", "jpg", "webp", "avif"],
  audio: ["mp3", "wav", "flac", "m4a"],
  video: ["mp4", "mov", "webm", "gif"],
};
const imageExt = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff", "avif", "heic"]);
const audioExt = new Set(["mp3", "wav", "flac", "m4a", "aac", "ogg"]);
const videoExt = new Set(["mp4", "mov", "mkv", "avi", "webm", "m4v"]);

export function mediaKind(path: string): MediaKind {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (imageExt.has(ext)) return "image";
  if (audioExt.has(ext)) return "audio";
  if (videoExt.has(ext)) return "video";
  return "unknown";
}


export function QuickConvertPlugin() {
  const sdk=useRef<MistyAppSDK|null>(null); const alive=useRef(false); const operation=useRef<AbortController|null>(null);
  const [files,setFiles]=useState<MistyFileHandle[]>([]);
  const [folder,setFolder]=useState<{handle:string;name:string}|null>(null);
  const [availability,setAvailability]=useState<{available:boolean;formats:string[];message?:string}|null>(null);
  const [format,setFormat]=useState(""); const [quality,setQuality]=useState<"small"|"balanced"|"high">("balanced");
  const [busy,setBusy]=useState(false); const [running,setRunning]=useState(false); const [error,setError]=useState("");
  const [rows,setRows]=useState<ConvertRow[]>([]); const [status,setStatus]=useState("Choose media files and an output folder.");
  useEffect(() => {
    alive.current=true;
    try { sdk.current=connectMistyApp(); void sdk.current.media.status().then(value=>{if(alive.current)setAvailability(value);},error=>{if(alive.current)setError(String(error));}); }
    catch(error){setError(String(error));}
    return ()=>{alive.current=false;operation.current?.abort();};
  },[]);
  const detected=files.length?mediaKind(files[0].name):"unknown";
  const compatible=detected!=="unknown"&&files.every(file=>mediaKind(file.name)===detected);
  const formats=compatible?presets[detected as Exclude<MediaKind,"unknown">].filter(format=>availability?.formats.includes(format)):[];
  const selectedFormat=formats.includes(format)?format:formats[0]??"";
  const choose=async(output:boolean)=>{
    if(!sdk.current||busy||running)return;
    setBusy(true);setError("");
    try{
      if(output){const next=await sdk.current.files.pickDirectory({write:true});if(alive.current&&next){if(folder)void sdk.current.files.release(folder.handle).catch(()=>undefined);setFolder(next);}}
      else{const next=await sdk.current.files.pickMany();if(alive.current&&next.length){files.forEach(file=>void sdk.current!.files.release(file.handle).catch(()=>undefined));setFiles(next);setRows([]);}}
    }catch(error){if(alive.current)setError(String(error));}finally{if(alive.current)setBusy(false);}
  };
  const start=async()=>{
    if(!sdk.current||!folder||!selectedFormat||busy||running)return;
    const abort=new AbortController();operation.current=abort;setRunning(true);setRows([]);setError("");setStatus("Converting media…");
    try{
      const result=await convertMedia(sdk.current,files,folder.handle,selectedFormat,quality,abort.signal,value=>{if(alive.current){setRows(value);setStatus(`Processed ${value.length} of ${files.length} files.`);}});
      if(alive.current)setStatus(`Saved ${result.filter(row=>row.output).length} copies in ${folder.name}. Originals were kept.`);
    }catch(error){if(alive.current){if(abort.signal.aborted)setStatus("Cancelled. Completed copies were kept.");else setError(String(error));}}
    finally{operation.current=null;if(alive.current)setRunning(false);}
  };
  return <div className="panel-stack">
    <header className="panel-title"><h2>Quick Convert</h2><p>Convert images, audio, and video into new copies.</p></header>
    <div className="selection-card"><div><span>Selection</span><strong>{files.length?`${files.length} ${detected} file${files.length===1?"":"s"}`:"No files chosen"}</strong></div><span className={`dependency-pill ${availability?.available?"ready":""}`}>{availability===null?"Checking converter…":availability.available?"Converter ready":"Converter unavailable"}</span></div>
    <div className="action-row"><ActionButton type="button" className="secondary-button" disabled={busy||running} onClick={()=>void choose(false)}><FolderOpen size={16}/>Choose media</ActionButton><ActionButton type="button" className="secondary-button" disabled={busy||running} onClick={()=>void choose(true)}><FolderOpen size={16}/>Choose output folder</ActionButton></div>
    <p>Save copies in: <strong>{folder?.name??"Choose a folder"}</strong></p>
    <div className="control-grid"><Field label="Output format"><select className="select-input" value={selectedFormat} onChange={event=>setFormat(event.target.value)} disabled={!compatible||running}>{formats.length?formats.map(format=><option key={format} value={format}>{format.toUpperCase()}</option>):<option value="">Choose compatible media</option>}</select></Field><Field label="Quality"><select className="select-input" value={quality} onChange={event=>setQuality(event.target.value as typeof quality)} disabled={running}><option value="small">Smaller file</option><option value="balanced">Balanced</option><option value="high">High quality</option></select></Field></div>
    {rows.length?<div className="outcome-list">{rows.map((row,index)=><div key={index}><span>{row.source}</span><strong className={row.error?"danger-text":"success-text"}>{row.error??row.output}</strong></div>)}</div>:null}
    {running?<div className="progress-track"><span style={{width:`${rows.length/files.length*100}%`}}/></div>:null}
    <StatusLine tone={error||availability?.available===false?"error":"neutral"}>{error||availability?.message||(!compatible&&files.length?"Choose files of one supported media type.":status)}</StatusLine>
    <div className="action-row"><ActionButton type="button" disabled={!availability?.available||!compatible||!folder||busy||running} onClick={()=>void start()}><Wand2 size={16}/>{running?"Converting…":"Convert"}</ActionButton>{running?<ActionButton type="button" className="secondary-button" onClick={()=>operation.current?.abort()}><Ban size={16}/>Cancel</ActionButton>:null}</div>
  </div>;
}
