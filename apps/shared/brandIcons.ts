import brand0 from "./brand-icons/airtable.svg?inline";
import brand1 from "./brand-icons/akamai.svg?inline";
import brand2 from "./brand-icons/alibaba.svg?inline";
import brand3 from "./brand-icons/anthropic.svg?inline";
import brand4 from "./brand-icons/asana.svg?inline";
import brand5 from "./brand-icons/aws.svg?inline";
import brand6 from "./brand-icons/azure.svg?inline";
import brand7 from "./brand-icons/backblaze.svg?inline";
import brand8 from "./brand-icons/box.svg?inline";
import brand9 from "./brand-icons/bytedance.svg?inline";
import brand10 from "./brand-icons/citrix.svg?inline";
import brand11 from "./brand-icons/cloudinary.svg?inline";
import brand12 from "./brand-icons/deepseek.svg?inline";
import brand13 from "./brand-icons/discord.svg?inline";
import brand14 from "./brand-icons/dropbox.svg?inline";
import brand15 from "./brand-icons/figma.svg?inline";
import brand16 from "./brand-icons/file-io.svg?inline";
import brand17 from "./brand-icons/filen.svg?inline";
import brand18 from "./brand-icons/files-com.svg?inline";
import brand19 from "./brand-icons/filezilla.svg?inline";
import brand20 from "./brand-icons/gemini.svg?inline";
import brand21 from "./brand-icons/github.svg?inline";
import brand22 from "./brand-icons/gmail.svg?inline";
import brand23 from "./brand-icons/google-calendar.svg?inline";
import brand24 from "./brand-icons/google-cloud.svg?inline";
import brand25 from "./brand-icons/google-docs.svg?inline";
import brand26 from "./brand-icons/google-drive.svg?inline";
import brand27 from "./brand-icons/google-photos.svg?inline";
import brand28 from "./brand-icons/google-sheets.svg?inline";
import brand29 from "./brand-icons/hadoop.svg?inline";
import brand30 from "./brand-icons/huawei.svg?inline";
import brand31 from "./brand-icons/hubspot.svg?inline";
import brand32 from "./brand-icons/huggingface.svg?inline";
import brand33 from "./brand-icons/icloud.svg?inline";
import brand34 from "./brand-icons/instagram.svg?inline";
import brand35 from "./brand-icons/internet-archive.svg?inline";
import brand36 from "./brand-icons/jira.svg?inline";
import brand37 from "./brand-icons/linear.svg?inline";
import brand38 from "./brand-icons/mail-ru.svg?inline";
import brand39 from "./brand-icons/mega.svg?inline";
import brand40 from "./brand-icons/messenger.svg?inline";
import brand41 from "./brand-icons/meta.svg?inline";
import brand42 from "./brand-icons/microsoft-onenote.svg?inline";
import brand43 from "./brand-icons/microsoft-teams.svg?inline";
import brand44 from "./brand-icons/microsoft-todo.svg?inline";
import brand45 from "./brand-icons/microsoft-word.svg?inline";
import brand46 from "./brand-icons/mistral.svg?inline";
import brand47 from "./brand-icons/notion.svg?inline";
import brand48 from "./brand-icons/nvidia.svg?inline";
import brand49 from "./brand-icons/obsidian.svg?inline";
import brand50 from "./brand-icons/ollama.svg?inline";
import brand51 from "./brand-icons/onedrive.svg?inline";
import brand52 from "./brand-icons/openai.svg?inline";
import brand53 from "./brand-icons/openstack.svg?inline";
import brand54 from "./brand-icons/outlook.svg?inline";
import brand55 from "./brand-icons/perplexity.svg?inline";
import brand56 from "./brand-icons/proton-drive.svg?inline";
import brand57 from "./brand-icons/seafile.svg?inline";
import brand58 from "./brand-icons/slack.svg?inline";
import brand59 from "./brand-icons/storj.svg?inline";
import brand60 from "./brand-icons/stripe.svg?inline";
import brand61 from "./brand-icons/todoist.svg?inline";
import brand62 from "./brand-icons/trello.svg?inline";
import brand63 from "./brand-icons/typeform.svg?inline";
import brand64 from "./brand-icons/vercel.svg?inline";
import brand65 from "./brand-icons/x.svg?inline";
import brand66 from "./brand-icons/yahoo.svg?inline";
import brand67 from "./brand-icons/yandex.svg?inline";
import brand68 from "./brand-icons/zoho.svg?inline";

/** Canonical artwork shared by packages, navigation, tabs, Discover, and connections. */
export const brandIcons = {
  airtable: brand0,
  akamai: brand1,
  alibaba: brand2,
  anthropic: brand3,
  asana: brand4,
  aws: brand5,
  azure: brand6,
  backblaze: brand7,
  box: brand8,
  bytedance: brand9,
  citrix: brand10,
  cloudinary: brand11,
  deepseek: brand12,
  discord: brand13,
  dropbox: brand14,
  figma: brand15,
  "file-io": brand16,
  filen: brand17,
  "files-com": brand18,
  filezilla: brand19,
  gemini: brand20,
  github: brand21,
  gmail: brand22,
  "google-calendar": brand23,
  "google-cloud": brand24,
  "google-docs": brand25,
  "google-drive": brand26,
  "google-photos": brand27,
  "google-sheets": brand28,
  hadoop: brand29,
  huawei: brand30,
  hubspot: brand31,
  huggingface: brand32,
  icloud: brand33,
  instagram: brand34,
  "internet-archive": brand35,
  jira: brand36,
  linear: brand37,
  "mail-ru": brand38,
  mega: brand39,
  messenger: brand40,
  meta: brand41,
  "microsoft-onenote": brand42,
  "microsoft-teams": brand43,
  "microsoft-todo": brand44,
  "microsoft-word": brand45,
  mistral: brand46,
  notion: brand47,
  nvidia: brand48,
  obsidian: brand49,
  ollama: brand50,
  onedrive: brand51,
  openai: brand52,
  openstack: brand53,
  outlook: brand54,
  perplexity: brand55,
  "proton-drive": brand56,
  seafile: brand57,
  slack: brand58,
  storj: brand59,
  stripe: brand60,
  todoist: brand61,
  trello: brand62,
  typeform: brand63,
  vercel: brand64,
  x: brand65,
  yahoo: brand66,
  yandex: brand67,
  zoho: brand68,
} as const;

export type BrandId = keyof typeof brandIcons;

const aliases: Record<string, BrandId> = {
  google: "gmail",
  microsoft: "outlook",
  "outlook-calendar": "outlook",
  drive: "google-drive",
  googledrive: "google-drive",
  googledocs: "google-docs",
  googlecalendar: "google-calendar",
  googlesheets: "google-sheets",
  gphotos: "google-photos",
  b2: "backblaze",
  gcs: "google-cloud",
  filescom: "files-com",
  gofile: "file-io",
  hdfs: "hadoop",
  huaweidrive: "huawei",
  iclouddrive: "icloud",
  internetarchive: "internet-archive",
  mailru: "mail-ru",
  protondrive: "proton-drive",
  sharefile: "citrix",
  azureblob: "azure",
  azurefiles: "azure",
  netstorage: "akamai",
  s3: "aws",
  tardigrade: "storj",
  amazon: "aws",
  mistralai: "mistral",
  googlegemini: "gemini",
  teams: "microsoft-teams",
  word: "microsoft-word",
  onenote: "microsoft-onenote",
};

export function brandIconAsset(
  value: string,
): { id: BrandId; src: string } | undefined {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^(?:builtin|integration|provider):/, "")
    .replace(/[ _]+/g, "-");
  const id = Object.prototype.hasOwnProperty.call(aliases, normalized)
    ? aliases[normalized]
    : normalized;
  if (!Object.prototype.hasOwnProperty.call(brandIcons, id)) return undefined;
  return { id: id as BrandId, src: brandIcons[id as BrandId] };
}
