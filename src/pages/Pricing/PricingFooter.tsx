import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  {
    q: "Who supplies a Space’s capacity?",
    a: "The owner supplies the member limit and Library storage. Each member uses their own Mika credits.",
  },
  {
    q: "Can a Free member join a paid owner’s Space?",
    a: "Yes. Joining a paid owner’s Space does not require an upgrade.",
  },
  {
    q: "What happens when I run out of credits?",
    a: "Mika pauses. Wait for the monthly reset or add credits. There are no automatic overages.",
  },
  {
    q: "How does beta access work?",
    a: "Access opens in cohorts. Single-use codes and a 30-day Pro trial are planned.",
  },
  {
    q: "How does Misty handle my data?",
    a: "Private Files stay local or in the connected provider until added to a Space. Library items are stored for the Space. Mika uses permitted context.",
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
