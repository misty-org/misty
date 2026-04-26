import { useState } from "react";

const faqs = [
  {
    q: "Is this a one-time purchase?",
    a: "Yes. Pro and Max are perpetual licenses — you pay once and own it. There are no subscriptions, no renewals, and no expiration. Future updates are included.",
  },
  {
    q: "What counts as a device?",
    a: "A device is any machine you install and activate Misty on — a laptop, desktop, or server. Pro covers one device. Max covers all your devices, including future platforms like mobile.",
  },
  {
    q: "What's the difference between Pro and Max?",
    a: "Pro gives you every feature on a single device for $30. Max gives you every feature on unlimited devices for $89. If you have two or more devices, Max is almost always the better deal.",
  },
  {
    q: "What if I get a new computer?",
    a: "You can reassign your Pro license to a different device from your dashboard. Max has no restrictions — just install and activate on any device you own.",
  },
  {
    q: "What does Lite include?",
    a: "Lite is free forever. It includes one cloud provider, full file management, background transfers, unified search, and the Misty Cli. No credit card required.",
  },
  {
    q: "How does Misty handle my data?",
    a: "Misty never touches your files. All communication with cloud providers happens through a local proxy running on your machine. Your credentials and file data never leave your device.",
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
        <p className="pb-4 text-sm text-text-muted leading-relaxed">{a}</p>
      )}
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
