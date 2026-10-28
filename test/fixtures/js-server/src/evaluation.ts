import { client } from "./config-director-setup"

const evaluation = client.evaluate("my-config-key", false, { id: "user-id" });
if (evaluation.reason === "config-state-missing") {
  // No config with this key reached the SDK.
}
