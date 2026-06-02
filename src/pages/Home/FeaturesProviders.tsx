import {
  SiAmazons3,
  SiBox,
  SiDropbox,
  SiGoogledrive,
  SiMega,
} from "react-icons/si";
import { GrOnedrive } from "react-icons/gr";

const providers = [
  { Icon: SiGoogledrive, label: "Google Drive", iconClassName: "text-[#0F9D58]" },
  { Icon: GrOnedrive, label: "OneDrive", iconClassName: "text-[#0078D4]" },
  { Icon: SiDropbox, label: "Dropbox", iconClassName: "text-[#0061FF]" },
  { Icon: SiAmazons3, label: "Amazon S3", iconClassName: "text-[#FF9900]" },
  { Icon: SiMega, label: "Mega", iconClassName: "text-[#D9272E]" },
  { Icon: SiBox, label: "Box", iconClassName: "text-[#0061D5]" },
];

export default function FeaturesProviders() {
  return (
    <div>
      <div className="glass-card rounded-2xl p-4 md:p-6">
        <p className="mb-6 text-center text-sm font-medium text-text-muted">
          Popular cloud providers
        </p>
        <div className="flex flex-wrap items-start justify-center gap-6 md:gap-8">
          {providers.map(({ Icon, label, iconClassName }) => (
            <div key={label} className="group flex w-20 flex-col items-center gap-2.5">
              <div className="flex h-18 w-18 items-center justify-center rounded-2xl border border-white/15 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.18)] transition-all duration-300 group-hover:-translate-y-0.5 group-hover:shadow-[0_16px_40px_rgba(0,0,0,0.26)]">
                <Icon className={`h-11 w-11 transition-transform duration-300 group-hover:scale-105 ${iconClassName}`} />
              </div>
              <span className="text-center text-xs text-text-muted">{label}</span>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-col items-center gap-2">
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
          <p className="text-xs text-text-muted/60">
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
    </div>
  );
}
