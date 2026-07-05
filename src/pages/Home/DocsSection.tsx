const docs = [
  {
    title: "Getting Started",
    description: "Install Misty and connect your first cloud provider in minutes.",
    href: "/docs/introduction",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    title: "Cloud Providers",
    description: "Configure Google Drive, OneDrive, and other storage backends.",
    href: "/docs/providers-overview",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
      </svg>
    ),
  },
  {
    title: "Public Beta",
    description: "Download the free build, try the core workflows, and join Discord to report bugs.",
    href: "/download",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4.5 18.75h15" strokeLinecap="round" strokeLinejoin="round" />
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
