/**
 * Reads a file the app ships with (a sticker's artwork, served from the bundle) as text. Nothing
 * leaves the computer: the address is the app's own.
 */
export async function readBundledText(url: string): Promise<string | null> {
  const response = await fetch(url);
  return response.ok ? response.text() : null;
}
