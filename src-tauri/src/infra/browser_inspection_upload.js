function(target, input, origin) {
 try {
  const snapshot=window[Symbol.for("misty.browser.inspection.document")];
  if(location.origin!==origin || !snapshot || snapshot.document!==document || snapshot.nonce!==input.documentId || snapshot.consumed)throw new Error("Inspect the current document before uploading.");
  const targets=window[Symbol.for("misty.browser.inspection")];
  const record=targets?.get(target),element=record?.element;
  if(!element?.isConnected || record.readFingerprint(element)!==record.fingerprint)return {ok:false,errorCode:"browser_snapshot_stale",error:"The file input changed. Inspect again."};
  if(!(element instanceof HTMLInputElement)||element.type!=="file"||element.disabled)throw new Error("An enabled file input is required.");
  const file=input.file;
  if(!file||typeof file.base64!=="string"||file.base64.length>14000000||typeof file.name!=="string"||file.name.length>255)throw new Error("The task file is unavailable.");
  const bytes=Uint8Array.from(atob(file.base64),char=>char.charCodeAt(0));
  if(bytes.length!==file.byteSize)throw new Error("The task file size changed.");
  snapshot.consumed=true;targets.clear();
  const transfer=new DataTransfer();transfer.items.add(new File([bytes],file.name,{type:file.mimeType}));
  element.files=transfer.files;
  element.dispatchEvent(new Event("input",{bubbles:true}));element.dispatchEvent(new Event("change",{bubbles:true}));
  return {ok:true,inputSelected:element.files?.length===1&&element.files[0].size===bytes.length,name:file.name,byteSize:bytes.length,websiteUploadVerified:false};
 } catch(error){return {ok:false,error:String(error)}}
}
