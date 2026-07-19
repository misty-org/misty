import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

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

export default function PricingQA() {
  return (
    <div>
      <h2 className="mb-6 text-lg font-semibold text-foreground">Questions & Answers</h2>
      <Accordion type="multiple">
        {faqs.map((faq) => (
          <AccordionItem key={faq.q} value={faq.q}>
            <AccordionTrigger className="py-4 text-foreground hover:no-underline">
              {faq.q}
            </AccordionTrigger>
            <AccordionContent className="leading-relaxed text-muted-foreground">
              {faq.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
