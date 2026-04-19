const docs = [
  {
    title: "Getting Started",
    description: "Install Misty and connect your first cloud provider in minutes.",
    href: "/docs/getting-started",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    title: "Cloud Providers",
    description: "Configure Google Drive, OneDrive, and other storage backends.",
    href: "/docs/providers",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
      </svg>
    ),
  },
  {
    title: "Self-Hosting",
    description: "Deploy the backend proxy on your own infrastructure with Tailscale.",
    href: "/docs/self-hosting",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
      </svg>
    ),
  },
  {
    title: "API Reference",
    description: "gRPC service definitions and backend proxy endpoints.",
    href: "/docs/api",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
  },
];

export default function Docs() {
  return (
    <div>
      <h2 className="text-2xl md:text-3xl font-bold text-text tracking-tight mb-2">
        Docs
      </h2>
      <p className="text-sm text-text-muted mb-5">
        Everything you need to set up Misty.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {docs.map((doc) => (
          <a
            key={doc.title}
            href={doc.href}
            className="group flex items-start gap-4 p-6 rounded-xl border border-white/10 hover:bg-white/5 hover:border-white/20 transition-all"
          >
            <div className="p-2.5 rounded-lg bg-primary/10 text-primary shrink-0 group-hover:bg-primary/20 transition-colors">
              {doc.icon}
            </div>
            <div>
              <h3 className="text-text font-semibold mb-1 group-hover:text-primary transition-colors">
                {doc.title}
              </h3>
              <p className="text-sm text-text-muted leading-relaxed">
                {doc.description}
              </p>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}