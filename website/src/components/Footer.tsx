import { NavLink } from "react-router";

export default function Footer() {
  return (
    <footer className="border-t border-border/50 mt-20">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="flex flex-col md:flex-row justify-between items-start gap-8">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <img src="/misty.png" alt="Misty logo" className="w-6 h-6 opacity-60" />
              <span className="text-sm font-medium text-text-muted">Misty</span>
            </div>
            <p className="text-sm text-text-muted/60 max-w-xs">
              All your cloud files and devices in one place. Simple, private, and free.
            </p>
          </div>

          <div className="flex gap-8 sm:gap-12">
            <div className="flex flex-col gap-3">
              <span className="text-xs font-medium text-text-muted uppercase tracking-wider">Product</span>
              <NavLink to="/download" className="text-sm text-text-muted/60 hover:text-text transition-colors">Download</NavLink>
              <NavLink to="/pricing" className="text-sm text-text-muted/60 hover:text-text transition-colors">Pricing</NavLink>
            </div>
            <div className="flex flex-col gap-3">
              <span className="text-xs font-medium text-text-muted uppercase tracking-wider">Resources</span>
              <a href="https://github.com/kannachi323/misty" target="_blank" rel="noopener noreferrer" className="text-sm text-text-muted/60 hover:text-text transition-colors">GitHub</a>
            </div>
          </div>
        </div>
        <div className="mt-12 pt-6 border-t border-border/30 flex flex-col md:flex-row justify-between items-center gap-4">
          <span className="text-xs text-text-muted/40">Built with care. Open source.</span>
          <span className="text-xs text-text-muted/40">Misty File Manager</span>
        </div>
      </div>
    </footer>
  );
}
