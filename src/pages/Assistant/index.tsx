import { Bot } from "lucide-react";
import { BetaFeatureNotice } from "@/features/beta/BetaFeatureNotice";

export default function AssistantPage() {
  return <BetaFeatureNotice featureName="Agents" icon={Bot} />;
}
