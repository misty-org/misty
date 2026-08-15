import { httpRequest } from "@/api/client/http";

/** Reads preview bytes from a URL supplied by the native file-preview command. */
export async function fetchPreviewBytes(url: string): Promise<ArrayBuffer> {
  const response = await httpRequest(url);
  if (!response.ok) throw new Error(`The file reader returned ${response.status}.`);
  return response.arrayBuffer();
}
