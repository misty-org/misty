export function ProductScreenshot({
  src,
  alt,
  label,
  eager = false,
  className,
}: {
  src: string;
  alt: string;
  label: string;
  eager?: boolean;
  className?: string;
}) {
  return (
    <figure className={className}>
      <div className="overflow-hidden rounded-none border border-border bg-showcase p-1.5 sm:p-2">
        <div className="aspect-[16/10] overflow-hidden rounded-none bg-showcase">
          <img
            src={src}
            alt={alt}
            className="h-full w-full object-cover object-top"
            width="1600"
            height="1000"
            loading={eager ? "eager" : "lazy"}
            fetchPriority={eager ? "high" : "auto"}
            decoding="async"
          />
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-muted-foreground">
        {label}
      </figcaption>
    </figure>
  );
}
