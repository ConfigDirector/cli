import { legacyFlags } from "./legacy-flag-service";

export const darkMode = () => legacyFlags.getBooleanValue("legacy-dark-mode", false);
