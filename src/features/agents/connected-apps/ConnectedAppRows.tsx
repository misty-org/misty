import { DirectAppLogo } from "./DirectAppLogo";

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
