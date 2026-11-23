import { httpRequest } from "@/api/client/http";

export async function fetchPreviewBytes(url: string): Promise<ArrayBuffer> {
  const response = await httpRequest(url);
  if (!response.ok) throw new Error(`The file reader returned ${response.status}.`);
  return response.arrayBuffer();
}
