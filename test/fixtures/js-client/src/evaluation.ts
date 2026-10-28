import { client } from "./config-director-setup"

const evaluation = client.evaluate("my-config-key", false);
if (evaluation.reason === "client-not-ready") {
  // Config values have not arrived yet.
}
