import {
  Atom,
  Briefcase,
  ChartLine,
  Cpu,
  GraduationCap,
  HeartPulse,
  Megaphone,
  Scale,
  type LucideIcon,
} from "lucide-react";

/**
 * The research topics on the Lab's home. A topic is a setup, not a feature: the ask field's hint,
 * what the agent looks for first, and a cover. Starting from one makes an ordinary notebook.
 * Verticals never get sections of their own.
 */
interface NotebookTopic {
  id: string;
  label: string;
  icon: LucideIcon;
  emoji: string;
  /** The ask field's hint while the topic is chosen. */
  placeholder: string;
  /** Added to the research prompt: which sources come first, and what to be careful of. */
  focus: string;
}

export const notebookTopics: readonly NotebookTopic[] = [
  {
    id: "technology",
    label: "Technology and AI",
    icon: Cpu,
    emoji: "🤖",
    placeholder: "What do you want to understand?",
    focus:
      "Prefer official documentation, the makers' own announcements and papers, and well-known " +
      "explainers. Technology changes fast: prefer recent pages and say when each is from.",
  },
  {
    id: "finance",
    label: "Finance",
    icon: ChartLine,
    emoji: "📈",
    placeholder: "A company, a fund or a question",
    focus:
      "Prefer company filings and investor relations pages, earnings calls, reputable financial " +
      "news and official data. Note each source's date. This is research, never advice to buy " +
      "or sell.",
  },
  {
    id: "marketing",
    label: "Marketing",
    icon: Megaphone,
    emoji: "📣",
    placeholder: "A product, a market or a question",
    focus:
      "Prefer competitors' own sites and ad libraries, customer reviews, case studies with " +
      "numbers, and industry reports. Say where a figure is an estimate.",
  },
  {
    id: "business",
    label: "Business",
    icon: Briefcase,
    emoji: "💼",
    placeholder: "A business question",
    focus:
      "Prefer government and official small business sources, reputable guides and real " +
      "examples. Name the country when rules depend on it.",
  },
  {
    id: "science",
    label: "Science",
    icon: Atom,
    emoji: "🔬",
    placeholder: "A study, a field or a question",
    focus:
      "Prefer peer-reviewed papers, review articles and university or agency pages. Say how " +
      "strong the evidence is and whether a study was replicated.",
  },
  {
    id: "health",
    label: "Health",
    icon: HeartPulse,
    emoji: "🩺",
    placeholder: "A condition, a treatment or a question",
    focus:
      "Prefer medical bodies, public health agencies and peer-reviewed reviews. This is " +
      "research to discuss with a professional, never a diagnosis or treatment plan.",
  },
  {
    id: "law",
    label: "Law and policy",
    icon: Scale,
    emoji: "⚖️",
    placeholder: "A law, a policy or a question",
    focus:
      "Prefer the text of laws, government sites and court opinions. Name the jurisdiction. " +
      "This is research, not legal advice.",
  },
  {
    id: "study",
    label: "Study",
    icon: GraduationCap,
    emoji: "🎓",
    placeholder: "A subject or an exam",
    focus:
      "Prefer textbooks, open courses, lecture notes and well-known explainers, from the " +
      "basics up.",
  },
];

export function topicOf(id: string | undefined): NotebookTopic | undefined {
  return notebookTopics.find((topic) => topic.id === id);
}

/** What a new notebook from the home's ask field is: its title and what its agent researches. The
 * agent names the notebook once it has written the overview. */
export function startOf(text: string): { title: string; research: string } {
  return { title: "Untitled notebook", research: text.trim() };
}
