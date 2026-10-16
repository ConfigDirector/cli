import { useConfigValue } from "./legacy-config";

export function LegacyBanner() {
  const enabled = useConfigValue("legacy-banner", false);
  return enabled ? <aside>Legacy</aside> : null;
}
