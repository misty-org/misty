import { useState } from "react";

const PUBLIC_ASSET_BASE_URL =
  import.meta.env.VITE_PUBLIC_ASSET_BASE_URL || "https://public.mistysys.com";

function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

const tabs = [
  {
    label: "Files",
    key: "files",
    images: [
      { src: `${PUBLIC_ASSET_BASE_URL}/files/files1.png`, alt: "Misty files view" },
      { src: `${PUBLIC_ASSET_BASE_URL}/files/files2.png`, alt: "Misty files view (alternate)" },
    ],
  },
  {
    label: "Providers",
    key: "providers",
    images: [{ src: `${PUBLIC_ASSET_BASE_URL}/providers/provider1.png`, alt: "Misty providers view" }],
  },
  {
    label: "Plugins",
    key: "plugins",
    images: [{ src: "/misty-plugins.png", alt: "Misty plugins view" }],
  },
  {
    label: "Vault",
    key: "vault",
    images: [{ src: "/misty-backup.png", alt: "Misty vault view" }],
  },
];

export default function FeatureDemo() {
  const [activeView, setActiveView] = useState("files");
  const [virtualIndexByView, setVirtualIndexByView] = useState<Record<string, number>>({});
  const [transitionEnabled, setTransitionEnabled] = useState(true);
  const activeTab = tabs.find((t) => t.key === activeView) ?? tabs[0];
  const imageCount = activeTab.images.length;
  const repeatedImages = imageCount > 0 ? [...activeTab.images, ...activeTab.images, ...activeTab.images] : [];
  const totalSlides = repeatedImages.length;
  const defaultVirtualIndex = imageCount;
  const virtualIndex = imageCount > 0 ? (virtualIndexByView[activeTab.key] ?? defaultVirtualIndex) : 0;
  const activeSlide = imageCount > 0 ? mod(virtualIndex, imageCount) : 0;

  return (
    <div className="relative bg-[#2d2d2d]">
      {/* Title Bar with tabs */}
      <div className="h-10 w-full flex items-center justify-between bg-neutral-900/70 pl-3 overflow-x-auto">
        <div className="flex items-center gap-3">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveView(tab.key)}
              className={`px-3 py-1 text-xs font-medium rounded transition-all duration-200 whitespace-nowrap ${
                activeView === tab.key
                  ? "bg-white text-black"
                  : "text-text-muted hover:text-white hover:bg-white/10"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center h-full shrink-0">
          <button className="h-full px-3.5 flex items-center justify-center hover:bg-white/10 transition-colors">
            <svg className="w-3 h-3 text-neutral-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 6h8" />
            </svg>
          </button>
          <button className="h-full px-3.5 flex items-center justify-center hover:bg-white/10 transition-colors">
            <svg className="w-3 h-3 text-neutral-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="2" width="8" height="8" rx="0.5" />
            </svg>
          </button>
          <button className="h-full px-3.5 flex items-center justify-center hover:bg-red-600 transition-colors">
            <svg className="w-3 h-3 text-neutral-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content Area — preload all images, show active tab as a carousel */}
      <div className="group w-full overflow-hidden border-none relative">
        {tabs.flatMap((tab) =>
          tab.images.map((img) => <img key={`${tab.key}:${img.src}`} src={img.src} alt="" className="hidden" />),
        )}

        <div className="w-full overflow-hidden">
          <div
            className={`flex transform-gpu will-change-transform ${transitionEnabled ? "transition-transform duration-500 ease-out" : ""}`}
            style={{
              width: totalSlides > 0 ? `${totalSlides * 100}%` : "100%",
              transform: totalSlides > 0 ? `translateX(-${virtualIndex * (100 / totalSlides)}%)` : "translateX(0%)",
            }}
            onTransitionEnd={(e) => {
              if (e.propertyName !== "transform") return;
              if (imageCount <= 1) return;

              if (virtualIndex < imageCount) {
                setTransitionEnabled(false);
                setVirtualIndexByView((prev) => ({
                  ...prev,
                  [activeTab.key]: virtualIndex + imageCount,
                }));
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => setTransitionEnabled(true)),
                );
              } else if (virtualIndex >= imageCount * 2) {
                setTransitionEnabled(false);
                setVirtualIndexByView((prev) => ({
                  ...prev,
                  [activeTab.key]: virtualIndex - imageCount,
                }));
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => setTransitionEnabled(true)),
                );
              }
            }}
          >
            {repeatedImages.map((img, idx) => (
              <div
                key={`${activeTab.key}:${idx}:${img.src}`}
                className="shrink-0"
                style={{ width: totalSlides > 0 ? `${100 / totalSlides}%` : "100%" }}
              >
                <img src={img.src} alt={img.alt} className="w-full block select-none" draggable={false} />
              </div>
            ))}
          </div>
        </div>

        {imageCount > 1 && (
          <>
            <button
              type="button"
              onClick={() =>
                setVirtualIndexByView((current) => ({
                  ...current,
                  [activeTab.key]: (current[activeTab.key] ?? defaultVirtualIndex) - 1,
                }))
              }
              className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 hover:bg-white transition-colors p-2 shadow-sm opacity-100 md:opacity-0 pointer-events-auto md:pointer-events-none md:group-hover:opacity-100 md:group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto transition-opacity"
              aria-label="Previous image"
            >
              <svg className="w-4 h-4 text-black" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12.5 4.5L7.5 10l5 5.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() =>
                setVirtualIndexByView((current) => ({
                  ...current,
                  [activeTab.key]: (current[activeTab.key] ?? defaultVirtualIndex) + 1,
                }))
              }
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 hover:bg-white transition-colors p-2 shadow-sm opacity-100 md:opacity-0 pointer-events-auto md:pointer-events-none md:group-hover:opacity-100 md:group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto transition-opacity"
              aria-label="Next image"
            >
              <svg className="w-4 h-4 text-black" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7.5 4.5l5 5.5-5 5.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
              {activeTab.images.map((_, idx) => (
                <button
                  key={`${activeTab.key}:dot:${idx}`}
                  type="button"
                  onClick={() =>
                    setVirtualIndexByView((current) => {
                      const currentVirtual = current[activeTab.key] ?? defaultVirtualIndex;
                      const candidates = [idx, idx + imageCount, idx + imageCount * 2];
                      const best = candidates.reduce((bestIndex, candidate) => {
                        if (bestIndex === null) return candidate;
                        return Math.abs(candidate - currentVirtual) < Math.abs(bestIndex - currentVirtual)
                          ? candidate
                          : bestIndex;
                      }, null as number | null);

                      return { ...current, [activeTab.key]: best ?? idx + imageCount };
                    })
                  }
                  className={`h-1.5 rounded-full transition-all ${
                    idx === activeSlide ? "w-6 bg-white" : "w-1.5 bg-white/50 hover:bg-white/70"
                  }`}
                  aria-label={`Go to image ${idx + 1}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
