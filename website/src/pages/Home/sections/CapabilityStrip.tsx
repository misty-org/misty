import { publicPageContainer } from "@/components/marketing";
import { cn } from "@/lib/utils";
import { capabilities } from "../data";

export function CapabilityStrip({ proof }: { proof: string }) {
  return (
    <section className="border-b border-border">
      <div className={`${publicPageContainer} grid md:grid-cols-[1.1fr_1.9fr]`}>
        <p className="border-b border-border py-6 text-sm leading-6 text-muted-foreground md:border-b-0 md:border-r md:pr-10">
          {proof}
        </p>
        <ul className="grid grid-cols-2 md:grid-cols-3">
          {capabilities.map((capability, index) => (
            <li
              key={capability.name}
              className={cn(
                "border-border px-5 py-6",
                index % 2 === 1 && "border-l",
                index < 4 && "border-b",
                index % 3 === 0 ? "md:border-l-0" : "md:border-l",
                index >= 3 && "md:border-b-0",
              )}
            >
              <p className="text-sm font-medium text-foreground">
                {capability.name}
              </p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {capability.description}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
