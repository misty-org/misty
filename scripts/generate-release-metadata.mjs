import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(
  process.env.MISTY_RELEASE_METADATA_DIR ?? join(root, "artifacts", "release"),
);
mkdirSync(outputDirectory, { recursive: true });

const cyclonedxBinary = join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "cyclonedx-npm.cmd" : "cyclonedx-npm",
);
const webSBOM = join(outputDirectory, "misty-web.cdx.json");
const result = spawnSync(
  cyclonedxBinary,
  [
    "--package-lock-only",
    "--ignore-npm-errors",
    "--omit",
    "dev",
    "--output-reproducible",
    "--validate",
    "--output-file",
    webSBOM,
    join(root, "package.json"),
  ],
  { cwd: root, encoding: "utf8" },
);
if (result.status !== 0) {
  const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  throw new Error(
    `CycloneDX generation failed with status ${result.status}${details ? `:\n${details}` : ""}`,
  );
}

const bom = JSON.parse(readFileSync(webSBOM, "utf8"));
const components = [...(bom.components ?? [])].sort((left, right) =>
  `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
);
const noticeLines = [
  "# Misty third-party software notices",
  "",
  "Misty includes the following production JavaScript packages. The canonical",
  "license declarations and package URLs are also shipped in the CycloneDX SBOM.",
  "",
  "| Package | Version | License | Package URL |",
  "| --- | --- | --- | --- |",
];
for (const component of components) {
  const license =
    component.licenses
      ?.map((entry) => entry.license?.id ?? entry.license?.name ?? entry.expression)
      .filter(Boolean)
      .join(", ") ?? "Not declared";
  noticeLines.push(
    `| ${escapeCell(component.name)} | ${escapeCell(component.version ?? "")} | ${escapeCell(license)} | ${escapeCell(component.purl ?? "")} |`,
  );
}
writeFileSync(
  join(outputDirectory, "THIRD_PARTY_NOTICES.md"),
  `${noticeLines.join("\n")}\n`,
);

const checksumRoot = process.argv[2] ? resolve(process.argv[2]) : null;
if (checksumRoot) {
  const files = walk(checksumRoot).filter(
    (file) => basename(file) !== "SHA256SUMS",
  );
  const sums = files
    .sort()
    .map((file) => {
      const digest = createHash("sha256")
        .update(readFileSync(file))
        .digest("hex");
      return `${digest}  ${relative(checksumRoot, file).replaceAll("\\", "/")}`;
    });
  writeFileSync(join(checksumRoot, "SHA256SUMS"), `${sums.join("\n")}\n`);
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}
