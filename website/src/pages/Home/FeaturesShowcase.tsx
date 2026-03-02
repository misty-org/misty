export default function FeaturesShowcase() {
  const features = [
  {
    title: "Fast, native speed with zero bloat.",
    description:
      "Misty's application window is built for raw performance. Say goodbye to sluggish cloud web wrappers and experience a lightweight interface that reacts instantly to every click.",
    placeholder: "ImGui Interface Screenshot",
    source: "/misty-bloat.png",
  },
  {
    title: "Secure connections and transfers",
    description:
      "Seamlessly link your external storage providers. Our robust proxy architecture securely handles your authentication and API routing, keeping your credentials safe and your transfers reliable.",
    placeholder: "Cloud Auth/Proxy Screenshot",
    source: "/misty-services.mp4"
  }
];
  return (
    <div className="flex flex-col gap-20">
      {features.map((feature, index) => (
        <div
          key={index}
          className="bg-neutral-900/50 rounded-2xl border border-neutral-800 p-4 h-120"
        >
          <div
            className={`flex items-stretch gap-10 h-full text-left ${
              index % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"
            }`}
          >
            <div className="w-full md:w-3/5 ">
              <div className="h-full bg-neutral-800 rounded-2xl border border-neutral-700 shadow-2xl flex items-center justify-center p-4">
                {feature.source ? (
                  <video
                    src={feature.source}
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="h-full w-full object-fit rounded-xl"
                  />
                ) : (
                  <span className="text-text-muted font-mono text-sm">
                    {feature.placeholder}
                  </span>
                )}
              </div>
            </div>
            <div className="w-full md:w-2/5 flex flex-col justify-center space-y-6 p-4">
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