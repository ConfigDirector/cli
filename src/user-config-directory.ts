import { join } from "node:path";
import { nonEmptyVariable, type Invocation } from "./Invocation.js";

const platformConfigDirectory = (invocation: Invocation): string => {
  switch (invocation.platform) {
    case "darwin":
      return join(invocation.homeDirectory, "Library", "Application Support");
    case "win32":
      return nonEmptyVariable(invocation, "APPDATA") ?? join(invocation.homeDirectory, "AppData", "Roaming");
    default:
      return join(invocation.homeDirectory, ".config");
  }
};

export const userConfigDirectory = (invocation: Invocation): string =>
  join(
    nonEmptyVariable(invocation, "XDG_CONFIG_HOME") ?? platformConfigDirectory(invocation),
    "configdirector",
  );
