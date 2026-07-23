import { Blocks } from "lucide-react";
import { BetaFeatureNotice } from "@/features/beta/BetaFeatureNotice";

export default function ExtensionsPage() {
  return <BetaFeatureNotice featureName="Extensions" icon={Blocks} />;
}
