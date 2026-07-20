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

import type { ProviderLogoProps } from "@/models/interfaces/pages/Providers/components/ProviderLogo";

export type ProviderLogoSpec =
  | { kind: "react"; icon: IconType; color?: string }
  | { kind: "lucide"; icon: typeof Cloud; color?: string }
  | { kind: "asset"; src: string };
