import { httpRequest } from "@/api/client/http";

const onThisComputer = (url: string) =>
  !/^https?:\/\//i.test(url) || /^https?:\/\/[a-z-]+\.localhost\//i.test(url);

export async function fetchPreviewBytes(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = onThisComputer(url) ? await fetch(url, { signal }) : await httpRequest(url);
  if (!response.ok) throw new Error(`The file reader returned ${response.status}.`);
  return response.arrayBuffer();
}
