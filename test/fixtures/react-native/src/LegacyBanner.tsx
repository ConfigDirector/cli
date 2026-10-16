import { useConfigValue } from "./legacy-config";

export function LegacyBanner() {
  return useConfigValue("legacy-banner", false) ? <Text>Legacy</Text> : null;
}
