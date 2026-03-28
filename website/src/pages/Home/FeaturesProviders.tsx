import { SiGoogledrive, SiDropbox, SiMega, SiIcloud } from "react-icons/si";
import { TiPlus } from "react-icons/ti";
import { GrOnedrive } from "react-icons/gr";

export default function FeaturesProviders() {
  return (
    <div>
      <div className="text-center mb-16 md:mb-20">
        <h2 className="text-3xl md:text-4xl font-bold text-text mb-4 text-balance">
          Your files are <span className="gradient-text">everywhere</span>
        </h2>
        <p className="text-text-muted max-w-2xl mx-auto text-pretty">
          Some photos on Google Drive. Work documents on OneDrive. Shared folders
          on Dropbox. You shouldn't have to switch applications just to find important files.
        </p>
      </div>

      <div className="glass-card rounded-2xl p-6 md:p-8">
        <p className="text-sm font-medium text-center text-text-muted mb-6">
          Connect and sync with popular platforms
        </p>
        <div className="flex flex-row justify-center items-start gap-8">
          {[
            { Icon: SiGoogledrive, label: "Google Drive" },
            { Icon: GrOnedrive, label: "OneDrive" },
            { Icon: SiDropbox, label: "Dropbox" },
            { Icon: SiIcloud, label: "iCloud" },
            { Icon: SiMega, label: "Mega" },
            { Icon: TiPlus, label: "More"}
          ].map(({ Icon, label }) => (
            <div key={label} className="flex flex-col items-center gap-2 group">
              <div className="w-18 h-18 rounded-2xl bg-surface flex items-center justify-center border 
                border-border/50 transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-lg group-hover:shadow-primary/10">
                <Icon className="w-12 h-12 text-text-secondary transition-colors group-hover:text-primary" />
              </div>
              <span className="text-xs text-text-muted text-center w-16">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
