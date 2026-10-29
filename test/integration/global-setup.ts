import { access } from "node:fs/promises";
import { adminApiUnderTest, SKIPPED_WITHOUT_VARIABLES } from "./support/admin-api-under-test.js";
import { builtCli } from "./support/built-cli.js";

export default async () => {
  if (adminApiUnderTest() === undefined) {
    process.stdout.write(`${SKIPPED_WITHOUT_VARIABLES}\n`);
    return;
  }
  await access(builtCli).catch(() => {
    throw new Error(`${builtCli} is missing. Run \`yarn build\` first.`);
  });
};
