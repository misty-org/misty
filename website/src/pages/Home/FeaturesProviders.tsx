import { SiGoogledrive, SiDropbox, SiMega, SiIcloud } from "react-icons/si"; 
import { GrOnedrive } from "react-icons/gr";

export default function FeaturesProviders() {
  return (
      <div>
        
        {/* Section Header */}
        <div className="text-center mb-16 md:mb-20">
          <h2 className="text-3xl md:text-4xl font-bold text-text mb-4 text-balance">
            Your files are everywhere
          </h2>
          <p className="text-text-muted max-w-2xl mx-auto text-pretty">
            Some photos on Google Drive. Work documents on OneDrive. Shared folders
            on Dropbox. And everything else scattered across all your devices. 
          </p>
        </div>

        {/* 2-Column Grid */}
        <div className="grid md:grid-cols-2 gap-10 lg:gap-16 items-center">
          <div className="glass-card rounded-2xl p-8 border-primary/20 shadow-lg shadow-primary/5">
            <h3 className="text-xl font-bold text-text mb-6">Misty helps you</h3>
            <ul className="flex flex-col gap-4 text-sm md:text-base text-text-muted">
              {/* 1. The Core Concept (Local + Remote) */}
              <li className="flex items-start gap-3">
                <svg className="w-5 h-5 text-primary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span>Manage local drives and remote storage from a native application</span>
              </li>

              {/* 2. The Core Action (Moving data) */}
              <li className="flex items-start gap-3">
                <svg className="w-5 h-5 text-primary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span>Drag and drop files seamlessly between different platforms</span>
              </li>

              {/* 3. The Global Search */}
              <li className="flex items-start gap-3">
                <svg className="w-5 h-5 text-primary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span>Fast searching across all your connected cloud storage at once</span>
              </li>

              {/* 4. The Power-User Feature */}
              <li className="flex items-start gap-3">
                <svg className="w-5 h-5 text-primary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span>Link multiple accounts from the same service to avoid complex management</span>
              </li>

            </ul>
          </div>

          {/* Right Column: Service Providers */}
          <div className="flex flex-col justify-center">
            
            {/* Header Area for Providers */}
            <div className="flex flex-row justify-center items-center gap-4 mb-6">
              <p className="text-sm font-medium text-text-muted text-center md:text-left m-0">
                Connect and sync with popular platforms
              </p>
              <button className="h-8 px-4 rounded-full bg-zinc-100 text-black text-xs font-bold hover:bg-gray-200 transition-all duration-300 shadow-md hover:shadow-zinc-100/20 flex items-center gap-1.5 group shrink-0">
                Learn more
                <span className="group-hover:translate-x-1 transition-transform duration-300">
                  &rarr;
                </span>
              </button>
            </div>
            
            {/* Provider Icons Box */}
            <div className="glass-card rounded-2xl overflow-hidden p-6 md:p-8 w-full">
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-6">
                
                {/* Google Drive */}
                <div className="flex flex-col items-center gap-2 group">
                  <div className="w-14 h-14 rounded-2xl bg-surface flex items-center justify-center border border-border/50 transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-lg group-hover:shadow-primary/10 group-hover:-translate-y-1">
                    <SiGoogledrive className="w-7 h-7 text-text-secondary transition-colors group-hover:text-primary" />
                  </div>
                  <span className="text-xs text-text-muted">Google Drive</span>
                </div>

                {/* OneDrive */}
                <div className="flex flex-col items-center gap-2 group">
                  <div className="w-14 h-14 rounded-2xl bg-surface flex items-center justify-center border border-border/50 transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-lg group-hover:shadow-primary/10 group-hover:-translate-y-1">
                    <GrOnedrive className="w-7 h-7 text-text-secondary transition-colors group-hover:text-primary" />
                  </div>
                  <span className="text-xs text-text-muted">OneDrive</span>
                </div>

                {/* Dropbox */}
                <div className="flex flex-col items-center gap-2 group">
                  <div className="w-14 h-14 rounded-2xl bg-surface flex items-center justify-center border border-border/50 transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-lg group-hover:shadow-primary/10 group-hover:-translate-y-1">
                    <SiDropbox className="w-7 h-7 text-text-secondary transition-colors group-hover:text-primary" />
                  </div>
                  <span className="text-xs text-text-muted">Dropbox</span>
                </div>

                {/* iCloud */}
                <div className="flex flex-col items-center gap-2 group">
                  <div className="w-14 h-14 rounded-2xl bg-surface flex items-center justify-center border border-border/50 transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-lg group-hover:shadow-primary/10 group-hover:-translate-y-1">
                    <SiIcloud className="w-7 h-7 text-text-secondary transition-colors group-hover:text-primary" />
                  </div>
                  <span className="text-xs text-text-muted">iCloud</span>
                </div>

                {/* Mega */}
                <div className="flex flex-col items-center gap-2 group">
                  <div className="w-14 h-14 rounded-2xl bg-surface flex items-center justify-center border border-border/50 transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-lg group-hover:shadow-primary/10 group-hover:-translate-y-1">
                    <SiMega className="w-7 h-7 text-text-secondary transition-colors group-hover:text-primary" />
                  </div>
                  <span className="text-xs text-text-muted">Mega</span>
                </div>

              </div>
            </div>

          </div>

        </div>
      </div>
  );
}