import {
  SiAmazons3,
  SiBox,
  SiDropbox,
  SiGooglecloudstorage,
  SiGoogledrive,
  SiMega,
} from "react-icons/si";
import { GrOnedrive } from "react-icons/gr";

export default function FeaturesProviders() {
  return (
    <div>
      <div className="glass-card rounded-2xl p-4 md:p-6">
        <p className="text-sm font-medium text-center text-text-muted mb-6">
          Popular cloud providers
        </p>
        <div className="flex flex-wrap justify-center items-start gap-6 md:gap-8">
          {[
            { Icon: SiGoogledrive, label: "Google Drive" },
            { Icon: GrOnedrive, label: "OneDrive" },
            { Icon: SiDropbox, label: "Dropbox" },
            { Icon: SiAmazons3, label: "Amazon S3" },
            { Icon: SiMega, label: "MEGA" },
            { Icon: SiGooglecloudstorage, label: "Google Cloud Storage" },
            { Icon: SiBox, label: "Box" },
          ].map(({ Icon, label }) => (
            <div key={label} className="flex flex-col items-center gap-2 group">
              <div className="w-18 h-18 rounded-2xl bg-surface flex items-center justify-center border
                border-border/50 transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-lg group-hover:shadow-primary/10">
                <Icon className="w-12 h-12 text-text-secondary transition-colors group-hover:text-primary" />
              </div>
              <span className="text-xs text-text-muted text-center w-20">{label}</span>
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
              className="text-text hover:text-white transition-colors underline underline-offset-4"
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
              className="text-text-muted hover:text-white transition-colors"
            >
              rclone
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
