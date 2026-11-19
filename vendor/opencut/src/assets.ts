// Misty: OpenCut serves its fonts atlas, flag stickers and effect preview from its web app's
// public folder. Misty's window has none (its Vite config sets `publicDir: false`), so they are
// bundled from vendor/opencut/public and looked up here by the path OpenCut asks for.
const bundled = import.meta.glob("../public/**/*", {
	query: "?url",
	import: "default",
	eager: true,
}) as Record<string, string>;

const byPath = new Map(
	Object.entries(bundled).map(([file, url]) => [file.replace(/^\.\.\/public/, ""), url]),
);

/** The bundled URL of an OpenCut asset such as "/flags/fr.svg", or the path as given. */
export function opencutAssetUrl(path: string): string {
	return byPath.get(path) ?? path;
}
