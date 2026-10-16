"use client";

import { useConfigValue } from "./legacy-config";

export const LegacyBanner = () => (useConfigValue("legacy-banner", false) ? <aside>Legacy</aside> : null);
