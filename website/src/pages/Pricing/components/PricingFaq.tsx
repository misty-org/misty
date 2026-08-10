import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { pricingFaqs } from "../data";

export default function PricingFaq() {
  return (
    <div>
      <h2 className="mb-6 text-2xl font-medium tracking-[-0.03em] text-foreground">
        Questions and answers
      </h2>
      <Accordion type="multiple">
        {pricingFaqs.map((faq) => (
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
