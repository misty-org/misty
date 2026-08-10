import { publicPageContainer } from "@/components/marketing";
import type { MarketingCopy } from "@/content/marketingCopy";

export function HowItWorks({ copy }: { copy: MarketingCopy["home"] }) {
  return (
    <section
      id="how-misty-works"
      className="scroll-mt-24 border-b border-border py-16 sm:py-24"
    >
      <div className={publicPageContainer}>
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-16">
          <h2 className="max-w-xl text-balance text-4xl font-medium leading-[1.04] tracking-[-0.045em] text-foreground sm:text-5xl">
            {copy.workflowTitle}
          </h2>
          <p className="max-w-lg text-base leading-7 text-muted-foreground">
            {copy.workflowDescription}
          </p>
        </div>
        <ol className="mt-14 grid border-t border-border md:grid-cols-3">
          {copy.workflow.map((step, index) => (
            <li
              key={step.title}
              className="border-b border-border py-8 md:border-b-0 md:border-l md:px-8 first:md:border-l-0 first:md:pl-0"
            >
              <span className="text-sm text-muted-foreground" aria-hidden="true">
                0{index + 1}
              </span>
              <h3 className="mt-10 text-xl font-medium tracking-[-0.02em] text-foreground">
                {step.title}
              </h3>
              <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
                {step.description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
