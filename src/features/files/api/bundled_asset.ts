export async function readBundledText(url: string): Promise<string | null> {
  const response = await fetch(url);
  return response.ok ? response.text() : null;
}
