export async function fetchPicture(url: string, signal?: AbortSignal): Promise<File> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`that picture couldn't be fetched (${response.status})`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("that address isn't a picture");
  const name = new URL(url).pathname.split("/").pop() || "picture";
  return new File([blob], name, { type: blob.type });
}
