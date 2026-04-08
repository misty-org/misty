import type { ProviderLogoSpec } from "@/models/types/pages/Providers/components/ProviderLogo";
export type { ProviderLogoSpec } from "@/models/types/pages/Providers/components/ProviderLogo";
import type { ProviderLogoProps } from "@/models/interfaces/pages/Providers/components/ProviderLogo";
export type { ProviderLogoProps } from "@/models/interfaces/pages/Providers/components/ProviderLogo";
import type { IconType } from "react-icons";
import {
  SiApachehadoop,
  SiAkamai,
  SiBackblaze,
  SiBox,
  SiCitrix,
  SiCloudinary,
  SiDropbox,
  SiFiledotio,
  SiFilen,
  SiFiles,
  SiGooglecloudstorage,
  SiHuawei,
  SiIcloud,
  SiInternetarchive,
  SiMaildotru,
  SiMega,
  SiOpenstack,
  SiProtondrive,
  SiSeafile,
  SiZoho,
} from "react-icons/si";
import {
  TbBrandAws,
  TbBrandAzure,
  TbBrandFilezilla,
  TbBrandGooglePhotos,
  TbBrandOnedrive,
  TbBrandStorj,
  TbBrandYandex,
} from "react-icons/tb";
import {
  Archive,
  Blocks,
  Box,
  Cloud,
  Combine,
  Database,
  FileArchive,
  Folder,
  Globe,
  HardDrive,
  KeyRound,
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
import { iconAssets } from "@/assets/icons";
import { AssetIcon } from "@/ui";

const brandLogoMap: Record<string, ProviderLogoSpec> = {
  b2: { kind: "react", icon: SiBackblaze, color: "#E21E29" },
  box: { kind: "react", icon: SiBox, color: "#0061D5" },
  cloudinary: { kind: "react", icon: SiCloudinary, color: "#3448C5" },
  dropbox: { kind: "react", icon: SiDropbox, color: "#0061FF" },
  filen: { kind: "react", icon: SiFilen, color: "#4F46E5" },
  filescom: { kind: "react", icon: SiFiles, color: "#6B7280" },
  gcs: { kind: "react", icon: SiGooglecloudstorage, color: "#4285F4" },
  gofile: { kind: "react", icon: SiFiledotio, color: "#2EA3F2" },
  gphotos: { kind: "react", icon: TbBrandGooglePhotos, color: "#34A853" },
  hdfs: { kind: "react", icon: SiApachehadoop, color: "#FFCC00" },
  huaweidrive: { kind: "react", icon: SiHuawei, color: "#D0021B" },
  iclouddrive: { kind: "react", icon: SiIcloud, color: "#A5B4FC" },
  internetarchive: { kind: "react", icon: SiInternetarchive, color: "#A5A5A5" },
  mailru: { kind: "react", icon: SiMaildotru, color: "#168DE2" },
  mega: { kind: "react", icon: SiMega, color: "#D9272E" },
  onedrive: { kind: "react", icon: TbBrandOnedrive, color: "#0078D4" },
  openstack: { kind: "react", icon: SiOpenstack, color: "#ED1944" },
  protondrive: { kind: "react", icon: SiProtondrive, color: "#6D4AFF" },
  sftp: { kind: "react", icon: TbBrandFilezilla, color: "#BF0000" },
  sharefile: { kind: "react", icon: SiCitrix, color: "#452170" },
  seafile: { kind: "react", icon: SiSeafile, color: "#FF9800" },
  yandex: { kind: "react", icon: TbBrandYandex, color: "#FC3F1D" },
  zoho: { kind: "react", icon: SiZoho, color: "#E42527" },
};

const backendLogoMap: Record<string, ProviderLogoSpec> = {
  alias: { kind: "lucide", icon: Link },
  archive: { kind: "lucide", icon: Archive },
  azureblob: { kind: "react", icon: TbBrandAzure, color: "#0078D4" },
  azurefiles: { kind: "react", icon: TbBrandAzure, color: "#0078D4" },
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
  netstorage: { kind: "react", icon: SiAkamai, color: "#0099D8" },
  oos: { kind: "lucide", icon: Database, color: "#C74634" },
  opendrive: { kind: "lucide", icon: Cloud },
  pcloud: { kind: "lucide", icon: Cloud },
  pikpak: { kind: "lucide", icon: Cloud },
  pixeldrain: { kind: "lucide", icon: Cloud },
  premiumizeme: { kind: "lucide", icon: Cloud },
  putio: { kind: "lucide", icon: Cloud },
  qingstor: { kind: "lucide", icon: Database },
  quatrix: { kind: "lucide", icon: SquareStack },
  s3: { kind: "react", icon: TbBrandAws, color: "#FF9900" },
  shade: { kind: "lucide", icon: Layers },
  sia: { kind: "lucide", icon: Blocks },
  smb: { kind: "lucide", icon: Network },
  storj: { kind: "react", icon: TbBrandStorj, color: "#2683FF" },
  sugarsync: { kind: "lucide", icon: Workflow },
  swift: { kind: "lucide", icon: Database },
  tardigrade: { kind: "react", icon: TbBrandStorj, color: "#2683FF" },
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
