import { iconAssets } from "@/shared/assets/icons";
import { AssetIcon } from "@/shared/ui";
import {
  Archive,
  Blocks,
  Box,
  Cloud,
  Combine,
  Database,
  FileArchive,
  Globe,
  HardDrive,
  Layers,
  Link,
  LockKeyhole,
  MemoryStick,
  Network,
  Server,
  ShieldCheck,
  Split,
  SquareStack,
  TableProperties,
  Workflow,
} from "lucide-react";
import { brandIconAsset } from "../../../../../misty-apps/apps/shared/brandIcons";
const brandLogoMap: Record<string, ProviderLogoSpec> = {
  b2: { kind: "asset", src: brandIconAsset("backblaze")!.src },
  box: { kind: "asset", src: brandIconAsset("box")!.src },
  cloudinary: { kind: "asset", src: brandIconAsset("cloudinary")!.src },
  dropbox: { kind: "asset", src: brandIconAsset("dropbox")!.src },
  filen: { kind: "asset", src: brandIconAsset("filen")!.src },
  filescom: { kind: "asset", src: brandIconAsset("files-com")!.src },
  gcs: { kind: "asset", src: brandIconAsset("google-cloud")!.src },
  gofile: { kind: "asset", src: brandIconAsset("file-io")!.src },
  gphotos: { kind: "asset", src: brandIconAsset("google-photos")!.src },
  hdfs: { kind: "asset", src: brandIconAsset("hadoop")!.src },
  huaweidrive: { kind: "asset", src: brandIconAsset("huawei")!.src },
  iclouddrive: { kind: "asset", src: brandIconAsset("icloud")!.src },
  internetarchive: { kind: "asset", src: brandIconAsset("internet-archive")!.src },
  mailru: { kind: "asset", src: brandIconAsset("mail-ru")!.src },
  mega: { kind: "asset", src: brandIconAsset("mega")!.src },
  onedrive: { kind: "asset", src: brandIconAsset("onedrive")!.src },
  openstack: { kind: "asset", src: brandIconAsset("openstack")!.src },
  protondrive: { kind: "asset", src: brandIconAsset("proton-drive")!.src },
  sftp: { kind: "asset", src: brandIconAsset("filezilla")!.src },
  sharefile: { kind: "asset", src: brandIconAsset("citrix")!.src },
  seafile: { kind: "asset", src: brandIconAsset("seafile")!.src },
  yandex: { kind: "asset", src: brandIconAsset("yandex")!.src },
  zoho: { kind: "asset", src: brandIconAsset("zoho")!.src },
};

const backendLogoMap: Record<string, ProviderLogoSpec> = {
  alias: { kind: "lucide", icon: Link },
  archive: { kind: "lucide", icon: Archive },
  azureblob: { kind: "asset", src: brandIconAsset("azure")!.src },
  azurefiles: { kind: "asset", src: brandIconAsset("azure")!.src },
  cache: { kind: "lucide", icon: HardDrive },
  chunker: { kind: "lucide", icon: Split },
  combine: { kind: "lucide", icon: Combine },
  compress: { kind: "lucide", icon: FileArchive },
  crypt: { kind: "lucide", icon: LockKeyhole },
  doi: { kind: "lucide", icon: TableProperties },
  drive: { kind: "asset", src: iconAssets.googleDriveColor },
  drime: { kind: "lucide", icon: Cloud },
  fichier: { kind: "lucide", icon: Cloud },
  filefabric: { kind: "lucide", icon: Network },
  filelu: { kind: "lucide", icon: Cloud },
  ftp: { kind: "lucide", icon: Server },
  hasher: { kind: "lucide", icon: ShieldCheck },
  hidrive: { kind: "lucide", icon: HardDrive },
  http: { kind: "lucide", icon: Globe },
  imagekit: { kind: "lucide", icon: Box },
  internxt: { kind: "lucide", icon: ShieldCheck },
  jottacloud: { kind: "lucide", icon: Cloud },
  koofr: { kind: "lucide", icon: Cloud },
  linkbox: { kind: "lucide", icon: Box },
  local: { kind: "lucide", icon: HardDrive },
  memory: { kind: "lucide", icon: MemoryStick },
  netstorage: { kind: "asset", src: brandIconAsset("akamai")!.src },
  oos: { kind: "lucide", icon: Database, color: "#C74634" },
  opendrive: { kind: "lucide", icon: Cloud },
  pcloud: { kind: "lucide", icon: Cloud },
  pikpak: { kind: "lucide", icon: Cloud },
  pixeldrain: { kind: "lucide", icon: Cloud },
  premiumizeme: { kind: "lucide", icon: Cloud },
  putio: { kind: "lucide", icon: Cloud },
  qingstor: { kind: "lucide", icon: Database },
  quatrix: { kind: "lucide", icon: SquareStack },
  s3: { kind: "asset", src: brandIconAsset("aws")!.src },
  shade: { kind: "lucide", icon: Layers },
  sia: { kind: "lucide", icon: Blocks },
  smb: { kind: "lucide", icon: Network },
  storj: { kind: "asset", src: brandIconAsset("storj")!.src },
  sugarsync: { kind: "lucide", icon: Workflow },
  swift: { kind: "lucide", icon: Database },
  tardigrade: { kind: "asset", src: brandIconAsset("storj")!.src },
  ulozto: { kind: "lucide", icon: Cloud },
  union: { kind: "lucide", icon: Layers },
  webdav: { kind: "lucide", icon: Globe },
};

export function ProviderLogo(props: ProviderLogoProps) {
  const size = props.size ?? 20;
  const spec = providerLogoSpecForType(props.type);
  const className = props.className;
  if (spec.kind === "asset") {
    return <AssetIcon className={className} src={spec.src} color size={size} title={props.title} />;
  }
  const Icon = spec.icon;
  return (
    <Icon
      className={className}
      size={size}
      aria-hidden={props.title ? undefined : true}
      aria-label={props.title}
      role={props.title ? "img" : undefined}
      color={spec.color ?? "currentColor"}
      strokeWidth={spec.kind === "lucide" ? 1.9 : undefined}
    />
  );
}

function providerLogoSpecForType(type: string): ProviderLogoSpec {
  const normalized = type.toLowerCase().replace(/[\s_-]+/g, "");
  return brandLogoMap[normalized] ?? backendLogoMap[normalized] ?? { kind: "lucide", icon: Cloud };
}

export type ProviderLogoSpec =
  { kind: "lucide"; icon: typeof Cloud; color?: string } | { kind: "asset"; src: string };

export interface ProviderLogoProps {
  type: string;
  size?: number;
  className?: string;
  title?: string;
}
