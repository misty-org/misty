import type {MistyAppSDK,MistyBrowserProvider} from "@misty/sdk";
/** Older hosts keep their legacy browser transport; they do not support discovery. */
export async function registerAgentDestinations(misty:MistyAppSDK,destinations:Array<{provider:MistyBrowserProvider;label:string;url:string}>){
 if(!misty.browser?.setDestinations)return;
 const context=await misty.context.get();if(!context.space?.id)return;
 try{await misty.browser.setDestinations(destinations)}catch(error){
  const code=error&&typeof error==="object"&&"code" in error?error.code:"";
  if(code!=="unsupported_method")throw error;
 }
}
