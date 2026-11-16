import { DirectAppLogo } from "./DirectAppLogo";

/**
 * An app's official logo: Misty's own artwork of the brand when it has one, else the logo its
 * maker published (fetched by native code), else its initial.
 */
export function AppLogo({
  app,
  name,
  logo,
  size = 24,
}: {
  app: string;
  name?: string;
  logo?: string;
  size?: number;
}) {
  return <DirectAppLogo app={app} name={name ?? app} icon={logo} size={size} />;
}
