import { useState } from "react";

const faqs = [
  {
    q: "What uses Misty credits?",
    a: "Only managed services with a real provider cost use credits: Mika requests, AI-backed automation nodes, and future hosted services that are clearly labeled before launch. Ordinary file operations and non-AI automations remain unmetered.",
  },
  {
    q: "Do unused monthly credits roll over?",
    a: "No. Plan credits reset each month, including for annual subscribers. Misty uses monthly credits before purchased credits so your top-ups are preserved.",
  },
  {
    q: "What happens when I run out of credits?",
    a: "Managed AI pauses without creating an overage bill. You can wait for your reset or add a prepaid pack: 1,500 credits for $4.99 or 3,500 for $9.99. Purchased credits do not expire while your account remains open.",
  },
  {
    q: "What's the difference between Pro and Max?",
    a: "Pro includes the complete data-management suite and 2,000 monthly credits. Max includes everything in Pro, triples the allowance to 6,000 credits, and unlocks deeper AI modes with larger context and output limits.",
  },
  {
    q: "Can I try Pro first?",
    a: "Yes. New eligible Basic accounts can start a 14-day Pro trial before subscribing.",
  },
  {
    q: "How does annual billing work?",
    a: "Pro is $99 per year and Max is $149 per year. Your included credits still reset monthly on your subscription anniversary rather than being granted all at once.",
  },
  {
    q: "How does Misty handle my data?",
    a: "Misty keeps file operations local and stores only usage metadata for billing. Billing records do not contain prompts, file paths, file contents, or model responses.",
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border last:border-none">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-4 py-4 text-left text-sm font-medium text-text transition-colors cursor-pointer"
      >
        {q}
        <svg
          className={`w-4 h-4 shrink-0 text-text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && <p className="pb-4 text-sm text-text-muted leading-relaxed">{a}</p>}
    </div>
  );
}

export default function PricingQA() {
  return (
    <div>
      <h2 className="text-lg font-semibold text-text mb-6">Questions & Answers</h2>
      <div>
        {faqs.map((faq) => (
          <FAQItem key={faq.q} q={faq.q} a={faq.a} />
        ))}
      </div>
    </div>
  );
}
