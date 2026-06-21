import { useState } from "react";
import { pricingFaqs } from "./data";

function FAQItem({
  question,
  answer,
  open,
  onToggle,
  isFirst,
  isLast,
}: {
  question: string;
  answer: string;
  open: boolean;
  onToggle: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <div className={`${!isFirst ? "border-t border-border" : ""} ${isLast ? "border-b border-border" : ""}`}>
      <h3 className="flex">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="group flex w-full items-center justify-between gap-6 py-4 text-left text-sm font-medium text-text transition-colors hover:text-white"
        >
          <span className="text-base leading-6">{question}</span>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center text-text-muted transition-transform duration-200">
            <svg
              className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25 12 15.75 4.5 8.25" />
            </svg>
          </span>
        </button>
      </h3>

      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="overflow-hidden">
          <div className="pb-5 pr-10">
            <p className="max-w-2xl text-sm leading-7 text-text-muted">{answer}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PricingQA() {
  const [openItems, setOpenItems] = useState<number[]>([0]);

  return (
    <section className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-0">
      <div className="lg:col-span-5 xl:col-span-4">
        <div className="lg:sticky lg:top-24 lg:pr-10">
          <h2 className="text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            Questions & Answers
          </h2>
        </div>
      </div>

      <div className="lg:col-span-7 xl:col-span-8">
        <div className="w-full text-text">
          {pricingFaqs.map((faq, index) => (
            <FAQItem
              key={faq.q}
              question={faq.q}
              answer={faq.a}
              open={openItems.includes(index)}
              onToggle={() =>
                setOpenItems((current) =>
                  current.includes(index)
                    ? current.filter((item) => item !== index)
                    : [...current, index]
                )
              }
              isFirst={index === 0}
              isLast={index === pricingFaqs.length - 1}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
