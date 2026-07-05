type ProviderIcon = {
  label: string;
  iconSrc: string;
};

type ProviderRow = {
  providers: ProviderIcon[];
  duration: number;
  direction: "normal" | "reverse";
  offset: string;
  opacity: string;
};

function iconify(icon: string, color?: string) {
  const params = color ? `?color=${encodeURIComponent(color)}` : "";
  return `https://api.iconify.design/${icon}.svg${params}`;
}

function favicon(domain: string) {
  return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
}

function googleFavicon(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

const providerIcons: Record<string, ProviderIcon> = {
  "Google Drive": {
    label: "Google Drive",
    iconSrc: iconify("simple-icons:googledrive", "#34a853"),
  },
  OneDrive: {
    label: "OneDrive",
    iconSrc: iconify("logos:microsoft-onedrive"),
  },
  Dropbox: {
    label: "Dropbox",
    iconSrc: iconify("simple-icons:dropbox", "#0061ff"),
  },
  "Amazon S3": {
    label: "Amazon S3",
    iconSrc: iconify("selfhst:amazon-s3"),
  },
  "Backblaze B2": {
    label: "Backblaze B2",
    iconSrc: iconify("simple-icons:backblaze", "#e21e29"),
  },
  Box: {
    label: "Box",
    iconSrc: iconify("simple-icons:box", "#0061d5"),
  },
  "Cloudflare R2": {
    label: "Cloudflare R2",
    iconSrc: iconify("simple-icons:cloudflare", "#f38020"),
  },
  "Google Cloud Storage": {
    label: "Google Cloud Storage",
    iconSrc: iconify("simple-icons:googlecloudstorage", "#4285f4"),
  },
  "Azure Blob": {
    label: "Azure Blob",
    iconSrc: iconify("logos:microsoft-azure"),
  },
  "Azure Files": {
    label: "Azure Files",
    iconSrc: iconify("logos:microsoft-azure"),
  },
  "Oracle Object Storage": {
    label: "Oracle Object Storage",
    iconSrc: iconify("logos:oracle"),
  },
  "OpenStack Swift": {
    label: "OpenStack Swift",
    iconSrc: iconify("simple-icons:openstack", "#ed1944"),
  },
  Wasabi: {
    label: "Wasabi",
    iconSrc: iconify("simple-icons:wasabi", "#01cd3e"),
  },
  "DigitalOcean Spaces": {
    label: "DigitalOcean Spaces",
    iconSrc: iconify("simple-icons:digitalocean", "#0080ff"),
  },
  "Alibaba Cloud OSS": {
    label: "Alibaba Cloud OSS",
    iconSrc: iconify("simple-icons:alibabacloud", "#ff6a00"),
  },
  "IBM COS S3": {
    label: "IBM COS S3",
    iconSrc: iconify("logos:ibm"),
  },
  "iCloud Drive": {
    label: "iCloud Drive",
    iconSrc: iconify("simple-icons:icloud", "#3693f3"),
  },
  "Google Photos": {
    label: "Google Photos",
    iconSrc: iconify("logos:google-photos"),
  },
  "Proton Drive": {
    label: "Proton Drive",
    iconSrc: iconify("simple-icons:protondrive", "#6d4aff"),
  },
  "Yandex Disk": {
    label: "Yandex Disk",
    iconSrc: iconify("arcticons:yandex-disk"),
  },
  "Zoho WorkDrive": {
    label: "Zoho WorkDrive",
    iconSrc: iconify("arcticons:zoho-workdrive"),
  },
  Mega: {
    label: "Mega",
    iconSrc: iconify("simple-icons:mega", "#d9272e"),
  },
  Filen: {
    label: "Filen",
    iconSrc: iconify("simple-icons:filen", "#000000"),
  },
  pCloud: {
    label: "pCloud",
    iconSrc: iconify("arcticons:pcloud"),
  },
  Seafile: {
    label: "Seafile",
    iconSrc: iconify("simple-icons:seafile", "#ff9800"),
  },
  Storj: {
    label: "Storj",
    iconSrc: iconify("selfhst:storj"),
  },
  Jottacloud: {
    label: "Jottacloud",
    iconSrc: iconify("arcticons:jottacloud"),
  },
  Koofr: {
    label: "Koofr",
    iconSrc: iconify("arcticons:koofr"),
  },
  Linkbox: {
    label: "Linkbox",
    iconSrc: iconify("arcticons:linkbox"),
  },
  Internxt: {
    label: "Internxt",
    iconSrc: favicon("internxt.com"),
  },
  "Akamai NetStorage": {
    label: "Akamai NetStorage",
    iconSrc: iconify("simple-icons:akamai", "#0096d6"),
  },
  "Citrix ShareFile": {
    label: "Citrix ShareFile",
    iconSrc: iconify("simple-icons:citrix", "#452170"),
  },
  Cloudinary: {
    label: "Cloudinary",
    iconSrc: iconify("logos:cloudinary-icon"),
  },
  "Huawei Drive": {
    label: "Huawei Drive",
    iconSrc: iconify("simple-icons:huawei", "#ff0000"),
  },
  "Internet Archive": {
    label: "Internet Archive",
    iconSrc: iconify("simple-icons:internetarchive", "#ffffff"),
  },
  IONOS: {
    label: "IONOS",
    iconSrc: iconify("simple-icons:ionos", "#003d8f"),
  },
  "1Fichier": {
    label: "1Fichier",
    iconSrc: favicon("1fichier.com"),
  },
  "Digi Storage": {
    label: "Digi Storage",
    iconSrc: favicon("storage.rcs-rds.ro"),
  },
  Drime: {
    label: "Drime",
    iconSrc: favicon("drime.cloud"),
  },
  FileLu: {
    label: "FileLu",
    iconSrc: favicon("filelu.com"),
  },
  Gofile: {
    label: "Gofile",
    iconSrc: favicon("gofile.io"),
  },
  HiDrive: {
    label: "HiDrive",
    iconSrc: favicon("hidrive.ionos.com"),
  },
  ImageKit: {
    label: "ImageKit",
    iconSrc: googleFavicon("imagekit.io"),
  },
  "Mail.ru Cloud": {
    label: "Mail.ru Cloud",
    iconSrc: favicon("cloud.mail.ru"),
  },
  OpenDrive: {
    label: "OpenDrive",
    iconSrc: favicon("opendrive.com"),
  },
  PikPak: {
    label: "PikPak",
    iconSrc: favicon("mypikpak.com"),
  },
  Pixeldrain: {
    label: "Pixeldrain",
    iconSrc: favicon("pixeldrain.com"),
  },
  "premiumize.me": {
    label: "premiumize.me",
    iconSrc: favicon("premiumize.me"),
  },
  "put.io": {
    label: "put.io",
    iconSrc: favicon("put.io"),
  },
  Quatrix: {
    label: "Quatrix",
    iconSrc: favicon("quatrix.it"),
  },
  QingStor: {
    label: "QingStor",
    iconSrc: googleFavicon("qingcloud.com"),
  },
  SugarSync: {
    label: "SugarSync",
    iconSrc: favicon("sugarsync.com"),
  },
  "Uloz.to": {
    label: "Uloz.to",
    iconSrc: favicon("uloz.to"),
  },
  HDFS: {
    label: "HDFS",
    iconSrc: favicon("hadoop.apache.org"),
  },
  Nextcloud: {
    label: "Nextcloud",
    iconSrc: iconify("simple-icons:nextcloud", "#0082c9"),
  },
  ownCloud: {
    label: "ownCloud",
    iconSrc: iconify("simple-icons:owncloud", "#041e42"),
  },
  SharePoint: {
    label: "SharePoint",
    iconSrc: iconify("mdi:microsoft-sharepoint", "#0078d4"),
  },
};

const providerRows: ProviderRow[] = [
  {
    providers: [
      providerIcons["Google Drive"],
      providerIcons.OneDrive,
      providerIcons.Dropbox,
      providerIcons["Amazon S3"],
      providerIcons["Backblaze B2"],
      providerIcons.Box,
      providerIcons["Cloudflare R2"],
      providerIcons["Google Cloud Storage"],
      providerIcons["Azure Blob"],
      providerIcons["Azure Files"],
      providerIcons["Oracle Object Storage"],
      providerIcons["OpenStack Swift"],
      providerIcons.Wasabi,
      providerIcons["DigitalOcean Spaces"],
    ],
    duration: 44,
    direction: "normal",
    offset: "ml-0",
    opacity: "opacity-100",
  },
  {
    providers: [
      providerIcons["iCloud Drive"],
      providerIcons["Google Photos"],
      providerIcons["Proton Drive"],
      providerIcons["Yandex Disk"],
      providerIcons["Zoho WorkDrive"],
      providerIcons.Mega,
      providerIcons.Filen,
      providerIcons.pCloud,
      providerIcons.Seafile,
      providerIcons.Storj,
      providerIcons.Jottacloud,
      providerIcons.Koofr,
      providerIcons.Linkbox,
      providerIcons.Internxt,
    ],
    duration: 52,
    direction: "reverse",
    offset: "-ml-20",
    opacity: "opacity-85",
  },
  {
    providers: [
      providerIcons["Akamai NetStorage"],
      providerIcons["Citrix ShareFile"],
      providerIcons.Cloudinary,
      providerIcons["Huawei Drive"],
      providerIcons["Internet Archive"],
      providerIcons.IONOS,
      providerIcons["1Fichier"],
      providerIcons["Digi Storage"],
      providerIcons.Drime,
      providerIcons.FileLu,
      providerIcons.Gofile,
      providerIcons.HiDrive,
      providerIcons.ImageKit,
    ],
    duration: 58,
    direction: "normal",
    offset: "-ml-10",
    opacity: "opacity-75",
  },
  {
    providers: [
      providerIcons["Mail.ru Cloud"],
      providerIcons.OpenDrive,
      providerIcons.PikPak,
      providerIcons.Pixeldrain,
      providerIcons["premiumize.me"],
      providerIcons["put.io"],
      providerIcons.Quatrix,
      providerIcons.QingStor,
      providerIcons.SugarSync,
      providerIcons["Uloz.to"],
      providerIcons.HDFS,
      providerIcons.Nextcloud,
      providerIcons.ownCloud,
      providerIcons.SharePoint,
    ],
    duration: 64,
    direction: "reverse",
    offset: "-ml-32",
    opacity: "opacity-65",
  },
  {
    providers: [
      providerIcons["Alibaba Cloud OSS"],
      providerIcons["IBM COS S3"],
      providerIcons["Cloudflare R2"],
      providerIcons.Wasabi,
      providerIcons["DigitalOcean Spaces"],
      providerIcons["Google Drive"],
      providerIcons.OneDrive,
      providerIcons["Amazon S3"],
      providerIcons["Backblaze B2"],
      providerIcons.Mega,
      providerIcons.Filen,
      providerIcons.Seafile,
      providerIcons.Storj,
      providerIcons.Nextcloud,
    ],
    duration: 56,
    direction: "normal",
    offset: "-ml-4",
    opacity: "opacity-80",
  },
];

function ProviderChip({ provider }: { provider: ProviderIcon }) {
  return (
    <span className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] pl-3 pr-4 text-sm font-medium text-text-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors hover:border-white/20 hover:bg-white/[0.065] hover:text-white">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/20">
        <img
          src={provider.iconSrc}
          alt=""
          className="h-3.5 w-3.5 object-contain"
          loading="lazy"
          decoding="async"
        />
      </span>
      {provider.label}
    </span>
  );
}

function ProviderMarqueeRow({ row }: { row: ProviderRow }) {
  const providers = [...row.providers, ...row.providers];

  return (
    <div className={`flex w-max gap-3 ${row.offset} ${row.opacity}`}>
      <div
        className="flex w-max gap-3 motion-reduce:animate-none"
        style={{
          animation: `provider-marquee ${row.duration}s linear infinite`,
          animationDirection: row.direction,
        }}
      >
        {providers.map((provider, index) => (
          <ProviderChip key={`${provider.label}-${index}`} provider={provider} />
        ))}
      </div>
    </div>
  );
}

export default function FeaturesProviders() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#090b0d] py-8 shadow-[0_22px_80px_rgba(0,0,0,0.24)] md:py-10">
      <style>{`
        @keyframes provider-marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
      `}</style>

      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-[#090b0d] to-transparent md:w-36" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-[#090b0d] to-transparent md:w-36" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.07),transparent_68%)]" />

      <div className="relative z-20 mx-auto mb-7 max-w-2xl px-5 text-center">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted/60">
          Storage backends
        </p>
        <h2 className="text-2xl font-bold tracking-tight text-text md:text-4xl">
          Connect the clouds, servers, and protocols you already use.
        </h2>
      </div>

      <div className="relative z-0 flex flex-col gap-3 py-2">
        {providerRows.map((row, index) => (
          <ProviderMarqueeRow key={index} row={row} />
        ))}
      </div>

      <div className="relative z-20 mx-auto mt-7 flex max-w-3xl flex-col items-center gap-2 px-5">
        <p className="text-center text-sm text-text-muted">
          Supports 70+ storage backends.{" "}
          <a
            href="https://rclone.org/#supported-providers"
            target="_blank"
            rel="noopener noreferrer"
            className="text-text underline underline-offset-4 transition-colors hover:text-white"
          >
            See the full compatibility list
          </a>
          .
        </p>
        <p className="text-center text-xs text-text-muted/55">
          Cloud provider connectivity powered by{" "}
          <a
            href="https://rclone.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-muted transition-colors hover:text-white"
          >
            rclone
          </a>
        </p>
      </div>
    </div>
  );
}
