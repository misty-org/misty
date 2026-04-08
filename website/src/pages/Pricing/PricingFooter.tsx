import { useState } from "react";

const faqs = [
  {
    q: "What is the right plan for me?",
    a: "Lite is free forever and covers everything you need to manage files across multiple cloud providers. Pro is a yearly plan that unlocks unlimited accounts, the Misty clipboard, and priority support. Max is a one-time purchase that gives you everything in Pro permanently, plus lifetime updates and unlimited clipboard transfers.",
  },
  {
    q: "What's the difference between Pro and Max?",
    a: "Pro is billed yearly and includes all premium features. Max is a one-time payment that gives you everything in Pro forever — no renewals, no expiration. Max also includes unlimited clipboard transfer data and priority feature requests.",
  },
  {
    q: "What payment options are available?",
    a: "We accept all major credit and debit cards. Payment is processed securely. Pro licenses are tied to your Misty account.",
  },
  {
    q: "Can I use Misty on multiple devices?",
    a: "Yes. Your Misty account works across all your devices. Both Lite and Pro are account-based, so your plan follows you wherever you install the app.",
  },
  {
    q: "How does Misty handle my data?",
    a: "Misty never stores your files or credentials on any external server. All cloud provider communication is proxied through a local service running on your own machine. Your data stays yours.",
  },
  {
    q: "Is Misty open source?",
    a: "Yes. Misty's core is open source. You can inspect the code, build from source, or contribute on GitHub.",
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border last:border-none">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-4 py-4 text-left text-sm font-medium text-text hover:text-text transition-colors cursor-pointer"
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
      {open && (
        <p className="pb-4 text-sm text-text-muted leading-relaxed">
          {a}
        </p>
      )}
    </div>
  );
}

export default function PricingQA() {
  return (
    <div className="">
      <h2 className="text-lg font-semibold text-text mb-6">Questions & Answers</h2>
      <div>
        {faqs.map((faq) => (
          <FAQItem key={faq.q} q={faq.q} a={faq.a} />
        ))}
      </div>
    </div>
  );
}
