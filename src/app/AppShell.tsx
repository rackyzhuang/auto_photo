import { App as DesktopApp } from "../App";
import { getPlatformCapabilities } from "../platform";
import { MobileApp } from "./MobileApp";

export function AppShell() {
  const capabilities = getPlatformCapabilities();
  return capabilities.usesMobileLayout ? <MobileApp capabilities={capabilities} /> : <DesktopApp />;
}
