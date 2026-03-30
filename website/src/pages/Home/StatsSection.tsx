const stats = [
  {
    value: "55",
    unit: "%",
    label: "Of users rely on 3+ different cloud services",
    sub: "Photos on Google Photos, documents on Dropbox, backups on iCloud — all separate.",
  },
  {
    value: "2.3B",
    unit: "",
    label: "Personal cloud storage users worldwide in 2025",
    sub: "Up from 1.1 billion in 2014. Cloud storage is now a universal part of daily life.",
  },
  {
    value: "71",
    unit: "%",
    label: "Store photos in the cloud",
    sub: "While 50% use cloud for backups and 41% for music and video — spread across different platforms.",
  },
  {
    value: "3+",
    unit: "services",
    label: "The average person's file footprint",
    sub: "People spread files across platforms for organisation, backup, and platform-specific perks.",
  },
];

export default function StatsSection() {
  return (
    <div>
      <div className="text-center mb-10">
        <h2 className="text-2xl md:text-3xl font-bold text-text mb-3">
          Your files are scattered. You shouldn't have to be.
        </h2>
        <p className="text-text-muted text-sm max-w-xl mx-auto">
          Cloud storage adoption is at an all-time high — but managing files across multiple services is still a mess.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="glass-card rounded-2xl p-6 flex flex-col gap-2">
            <div className="flex items-end gap-1.5">
              <span className="text-4xl font-bold text-white tracking-tight">{stat.value}</span>
              {stat.unit && (
                <span className="text-sm font-medium text-text-muted mb-1.5">{stat.unit}</span>
              )}
            </div>
            <p className="text-sm font-semibold text-text">{stat.label}</p>
            <p className="text-xs text-text-muted leading-relaxed">{stat.sub}</p>
          </div>
        ))}
      </div>

      <p className="text-center text-[11px] text-text-muted/50 mt-4">
        Sources: GoodFirms Personal Cloud Storage Trends Report
      </p>
    </div>
  );
}
