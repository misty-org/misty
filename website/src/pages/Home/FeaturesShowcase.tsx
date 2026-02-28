export default function FeaturesShowcase() {
  const features = [
  {
    title: "Native speed, zero web bloat.",
    description:
      "Misty's custom interface is built for raw performance. Say goodbye to sluggish web wrappers and experience a lightweight, desktop-class UI that reacts instantly to every click.",
    placeholder: "ImGui Interface Screenshot",
  },
  {
    title: "Secure connections to every cloud.",
    description:
      "Seamlessly link your external storage providers. Our robust proxy architecture securely handles your authentication and API routing, keeping your credentials safe and your transfers reliable.",
    placeholder: "Cloud Auth/Proxy Screenshot",
  },
  {
    title: "A backend built for heavy lifting.",
    description:
      "Under the hood, Misty utilizes a high-performance gRPC architecture to manage your distributed files. Move gigabytes across the globe as effortlessly as dragging a folder on your local drive.",
    placeholder: "File Transfer Screenshot",
  },
];
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      {features.map((feature, index) => (
        <div
          key={index}
          className="bg-neutral-900/50 rounded-2xl border border-neutral-800 py-16 px-4 sm:px-6 lg:px-20 mx-20"
        >
          <div
            className={`max-w-7xl mx-auto flex flex-col items-center gap-12 md:gap-24 ${
              index % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"
            }`}
          >
            <div className="w-full md:w-1/2">
              <div className="aspect-video bg-neutral-800 rounded-2xl border border-neutral-700 shadow-2xl flex items-center justify-center">
                <span className="text-text-muted font-mono text-sm">
                  {feature.placeholder}
                </span>
              </div>
            </div>
            <div className="w-full md:w-1/2 space-y-6">
              <h2 className="text-3xl md:text-4xl font-bold text-text tracking-tight">
                {feature.title}
              </h2>
              <p className="text-lg text-text-muted leading-relaxed">
                {feature.description}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}