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

import type { ProviderLogoSpec } from "@/models/types/pages/Providers/components/ProviderLogo";

export interface ProviderLogoProps {
  type: string;
  size?: number;
  className?: string;
  title?: string;
}
