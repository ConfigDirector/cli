import { writeRepositoryFile } from "../../support/repository-files.js";
import { removeWhenTestFinishes } from "./admin-api-under-test.js";
import { uniqueKey, uniqueRepositoryName, type CliUnderTest } from "./built-cli.js";

const requireSuccess = (description: string, result: { exitCode: number | null; stderr: string }): void => {
  if (result.exitCode !== 0) {
    throw new Error(`${description} exited ${result.exitCode}: ${result.stderr}`);
  }
};

export const configKeyRemovedWhenTestFinishes = (cli: CliUnderTest): string => {
  const key = uniqueKey();
  removeWhenTestFinishes(cli.adminApi, `/v1/projects/${cli.project.id}/configs/${key}`);
  return key;
};

export const createBooleanFlag = async (cli: CliUnderTest): Promise<string> => {
  const key = configKeyRemovedWhenTestFinishes(cli);

  const result = await cli.run([
    "configs",
    "create",
    "--key",
    key,
    "--type",
    "boolean",
    "--role",
    "flag",
    "--lifetime",
    "temporary",
    "--default-value",
    "false",
  ]);
  requireSuccess(`configs create --key ${key}`, result);

  return key;
};

export const emailCondition = {
  kind: "attribute",
  attribute: "traits",
  trait: "/email",
  operator: "ends with any of",
  targetType: "text",
  targetValues: ["@example.com"],
};

export const segmentFileOf = (key: string, name: string) => ({
  key,
  name,
  groups: [[emailCondition]],
});

export const createSegment = async (cli: CliUnderTest): Promise<string> => {
  const key = uniqueKey();
  removeWhenTestFinishes(cli.adminApi, `/v1/projects/${cli.project.id}/segments/${key}`);
  await writeRepositoryFile(
    cli.sandbox.workingDirectory,
    "segment.json",
    JSON.stringify(segmentFileOf(key, "Example staff")),
  );

  const result = await cli.run(["segments", "create", "--segment", "segment.json"]);
  requireSuccess(`segments create ${key}`, result);

  return key;
};

export const proPlanRulesFile = {
  defaultValue: false,
  rules: [
    {
      type: "conditional",
      order: 0,
      conditions: [
        {
          kind: "attribute",
          attribute: "traits",
          trait: "/plan",
          operator: "is one of",
          targetType: "text",
          targetValues: ["pro"],
        },
      ],
      target: "value",
      value: true,
      percentages: [],
    },
  ],
};

export const setProPlanRule = async (cli: CliUnderTest, configKey: string, environmentSlug: string) => {
  await writeRepositoryFile(cli.sandbox.workingDirectory, "rules.json", JSON.stringify(proPlanRulesFile));

  const result = await cli.run([
    "targeting-rules",
    "set",
    configKey,
    "--environment",
    environmentSlug,
    "--rules",
    "rules.json",
  ]);
  requireSuccess(`targeting-rules set ${configKey}`, result);
};

export const checkoutFileReading = (configKey: string): string =>
  [
    'import { createClient } from "@configdirector/server-sdk";',
    "",
    'const client = createClient("YOUR-SERVER-SDK-KEY");',
    `export const newCheckout = () => client.getValue("${configKey}", false);`,
    "",
  ].join("\n");

export const uploadScanOf = async (cli: CliUnderTest, configKey: string): Promise<string> => {
  const repositoryName = uniqueRepositoryName();
  removeWhenTestFinishes(
    cli.adminApi,
    `/v1/projects/${cli.project.id}/repositories/${encodeURIComponent(repositoryName)}`,
  );
  await writeRepositoryFile(cli.sandbox.workingDirectory, "src/checkout.ts", checkoutFileReading(configKey));

  const result = await cli.run(["scan", "--upload", "--repository", repositoryName]);
  requireSuccess(`scan --upload --repository ${repositoryName}`, result);

  return repositoryName;
};
