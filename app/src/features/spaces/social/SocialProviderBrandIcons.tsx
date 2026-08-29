import { SiMessenger, SiX } from "react-icons/si";

interface SocialProviderBrandIconProps {
  className?: string;
  "aria-hidden"?: boolean;
}

export function MessengerBrandIcon(props: SocialProviderBrandIconProps) {
  return <SiMessenger {...props} data-social-provider-icon="messenger" />;
}

export function XBrandIcon(props: SocialProviderBrandIconProps) {
  return <SiX {...props} data-social-provider-icon="x" />;
}
