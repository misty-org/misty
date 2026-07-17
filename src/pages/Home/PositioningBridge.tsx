type PositioningBridgeProps = {
  stages: string[];
  activeIndex: number;
  onSelect: (index: number) => void;
};

export default function PositioningBridge({
  stages,
  activeIndex,
  onSelect,
}: PositioningBridgeProps) {
  return (
    <div className="relative z-[70] mx-auto w-full px-2 text-center sm:px-3">
      <div
        className="mx-auto flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-2xl font-bold tracking-tight sm:w-max sm:max-w-none sm:flex-nowrap sm:text-3xl md:gap-x-4 md:text-5xl"
        aria-label="Feature chapters"
      >
        {stages.map((stage, index) => (
          <span key={stage} className="inline-flex items-center gap-x-2 md:gap-x-4">
            <button
              type="button"
              onClick={() => onSelect(index)}
              aria-current={activeIndex === index ? "step" : undefined}
              className={`relative rounded-sm px-1 py-1 transition-colors duration-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${
                activeIndex === index ? "text-text" : "text-text-muted/25 hover:text-text-muted/55"
              }`}
            >
              {stage}
            </button>
            {index < stages.length - 1 ? (
              <span aria-hidden="true" className="font-normal text-text-muted/20">
                &rarr;
              </span>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}
