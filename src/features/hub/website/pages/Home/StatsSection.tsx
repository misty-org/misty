const stats = [
  { value: "55%", label: "rely on 3+ cloud services" },
  { value: "2.3B", label: "cloud storage users worldwide" },
  { value: "71%", label: "store photos in the cloud" },
  { value: "3+", label: "services per person on average" },
];

export default function StatsSection() {
  return (
    <div className="glass-card rounded-2xl p-4 md:p-6">
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border">
        {stats.map((stat) => (
          <div key={stat.label} className="flex flex-col items-center text-center px-4 gap-1">
            <span className="text-2xl md:text-3xl font-bold text-white tracking-tight">{stat.value}</span>
            <span className="text-xs text-text-muted leading-snug">{stat.label}</span>
          </div>
        ))}
      </div>
      <p className="text-center text-[11px] text-text-muted/50 mt-5">
        Source: GoodFirms Personal Cloud Storage Trends Report
      </p>
    </div>
  );
}
