import { BrandIcon, type BrandIconProps } from "../../../../../misty-apps/apps/shared/BrandIcon";

export function MessengerBrandIcon(props: Omit<BrandIconProps, "brand">) {
  return <BrandIcon {...props} brand="messenger" />;
}

export function XBrandIcon(props: Omit<BrandIconProps, "brand">) {
  return <BrandIcon {...props} brand="x" />;
}
