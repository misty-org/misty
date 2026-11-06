/** The languages Soniox hears and translates between. */
const codes = [
  "af ar az be bg bn bs ca cs cy da de el en es et eu fa fi fr gl gu he hi hr",
  "hu id it ja kk kn ko lt lv mk ml mr ms nl no pa pl pt ro ru sk sl sq sr sv",
  "sw ta te th tl tr uk ur vi zh",
]
  .join(" ")
  .split(" ");

const names = new Intl.DisplayNames(["en"], { type: "language" });

export const languageName = (code: string) =>
  code === "auto" ? "Detect automatically" : (names.of(code) ?? code);

export const subtitleLanguages = codes
  .map((value) => ({ value, label: languageName(value) }))
  .sort((a, b) => a.label.localeCompare(b.label, "en"));

export const subtitleSources = [{ value: "auto", label: "Detect automatically" }, ...subtitleLanguages];
