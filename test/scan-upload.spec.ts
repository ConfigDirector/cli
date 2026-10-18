import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { projectPath, requestLinesOf } from "./support/browse-admin-api.js";
import {
  addOriginRemote,
  commitEveryFile,
  createRepositoryWithOrigin,
  initializeGitRepository,
} from "./support/git-repository.js";
import { writeRepositoryFile } from "./support/repository-files.js";
import { createSandbox, type Sandbox } from "./support/sandbox.js";
import { projectConfig, startScanAdminApi } from "./support/scan-admin-api.js";
import type { StubReply } from "./support/stub-admin-api.js";

const checkoutFile = [
  'import { createClient } from "@configdirector/server-sdk";',
  "",
  'const client = createClient("YOUR-SERVER-SDK-KEY");',
  'export const newCheckout = () => client.getValue("new-checkout", false);',
  "",
].join("\n");

const checkoutScanLines = [
  "new-checkout",
  "  src/checkout.ts:4 getValue (js-server)",
  "",
  "1 direct, 0 indirect and 0 dynamic references in 1 scanned file.",
  "",
];

const checkoutCommit = "4d40f509d1331d512f3afe8201f97339c808d651";

const newCheckoutReference = {
  key: "new-checkout",
  file: "src/checkout.ts",
  line: 4,
  kind: "direct",
  sdk: "js-server",
  call: "getValue",
  default: { type: "boolean", value: false },
  test: false,
};

const scannedRepository = (overrides: object = {}) => ({
  name: "ConfigDirector/cli",
  remoteUrl: "https://github.com/ConfigDirector/cli.git",
  commit: checkoutCommit,
  scannedAt: "2026-10-17T10:00:00.000Z",
  filesScanned: 1,
  referenceCount: 1,
  dynamicReferenceCount: 0,
  ...overrides,
});

const startUploadAdminApi = (repliesByPath: Record<string, StubReply>) =>
  startScanAdminApi({ configs: [projectConfig("new-checkout")], repliesByPath });

const uploadScanWithExecutableSearchPath = async (
  sandbox: Sandbox,
  baseUrl: string,
  executableSearchPath: string,
  commandLineArguments: string[] = [],
) => {
  const invocation = sandbox.invocation({
    commandLineArguments: [
      "scan",
      "--upload",
      "--project",
      "web-app",
      "--token",
      "cd_flag_token",
      ...commandLineArguments,
    ],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl, PATH: executableSearchPath },
  });

  const exitCode = await run(invocation);

  return { exitCode, stdout: invocation.stdout.text(), stderr: invocation.stderr.text() };
};

const uploadScan = (sandbox: Sandbox, baseUrl: string, commandLineArguments: string[] = []) =>
  uploadScanWithExecutableSearchPath(sandbox, baseUrl, process.env.PATH ?? "", commandLineArguments);

const uploadRequestsOf = (adminApi: Awaited<ReturnType<typeof startScanAdminApi>>) =>
  adminApi.receivedRequests
    .filter((request) => request.method === "PUT")
    .map((request) => ({ path: request.path, body: request.body }));

const uploadedRemotesOf = (adminApi: Awaited<ReturnType<typeof startScanAdminApi>>) =>
  uploadRequestsOf(adminApi).map((request) => ({
    path: request.path,
    remoteUrl: (request.body as { remoteUrl: string }).remoteUrl,
  }));

const uploadRepositoryWithOrigin = async (
  remoteUrl: string,
  uploadPath: string,
  uploadReply: StubReply,
  commandLineArguments: string[] = [],
) => {
  const adminApi = await startUploadAdminApi({ [uploadPath]: uploadReply });
  const sandbox = await createSandbox();
  await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", checkoutFile);
  await createRepositoryWithOrigin(sandbox.workingDirectory, remoteUrl);

  const result = await uploadScan(sandbox, adminApi.baseUrl, commandLineArguments);

  return { ...result, adminApi };
};

const uploadConfigDirectorCliRefusedWith = (uploadReply: StubReply) =>
  uploadRepositoryWithOrigin(
    "https://github.com/ConfigDirector/cli.git",
    projectPath("/repositories/ConfigDirector%2Fcli"),
    uploadReply,
  );

describe("scan --upload", () => {
  it("uploads the scan to the repository named after an https origin remote, with the remote URL and the commit", async () => {
    const { exitCode, stdout, stderr, adminApi } = await uploadRepositoryWithOrigin(
      "https://github.com/ConfigDirector/cli.git",
      projectPath("/repositories/ConfigDirector%2Fcli"),
      { status: 200, body: scannedRepository() },
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      ...checkoutScanLines,
      "Uploaded the scan of ConfigDirector/cli at 4d40f50 to web-app: 1 reference and 0 dynamic references, with 0 left out for a key that cannot be a config key.",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/configs")}`,
      `PUT ${projectPath("/repositories/ConfigDirector%2Fcli")}`,
    ]);
    expect(uploadRequestsOf(adminApi)).toEqual([
      {
        path: projectPath("/repositories/ConfigDirector%2Fcli"),
        body: {
          remoteUrl: "https://github.com/ConfigDirector/cli.git",
          commit: checkoutCommit,
          filesScanned: 1,
          references: [newCheckoutReference],
          dynamicReferences: [],
        },
      },
    ]);
  });

  it("names the repository after the path of an ssh origin remote in scp form", async () => {
    const { exitCode, stdout, stderr, adminApi } = await uploadRepositoryWithOrigin(
      "git@github.com:ConfigDirector/cli.git",
      projectPath("/repositories/ConfigDirector%2Fcli"),
      { status: 200, body: scannedRepository({ remoteUrl: "git@github.com:ConfigDirector/cli.git" }) },
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      ...checkoutScanLines,
      "Uploaded the scan of ConfigDirector/cli at 4d40f50 to web-app: 1 reference and 0 dynamic references, with 0 left out for a key that cannot be a config key.",
      "",
    ]);
    expect(uploadedRemotesOf(adminApi)).toEqual([
      {
        path: projectPath("/repositories/ConfigDirector%2Fcli"),
        remoteUrl: "git@github.com:ConfigDirector/cli.git",
      },
    ]);
  });

  it("names the repository after the path of an ssh origin remote in scp form through a host alias with no user", async () => {
    const { exitCode, stdout, stderr, adminApi } = await uploadRepositoryWithOrigin(
      "github-work:ConfigDirector/cli.git",
      projectPath("/repositories/ConfigDirector%2Fcli"),
      { status: 200, body: scannedRepository({ remoteUrl: "github-work:ConfigDirector/cli.git" }) },
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      ...checkoutScanLines,
      "Uploaded the scan of ConfigDirector/cli at 4d40f50 to web-app: 1 reference and 0 dynamic references, with 0 left out for a key that cannot be a config key.",
      "",
    ]);
    expect(uploadedRemotesOf(adminApi)).toEqual([
      {
        path: projectPath("/repositories/ConfigDirector%2Fcli"),
        remoteUrl: "github-work:ConfigDirector/cli.git",
      },
    ]);
  });

  it("names the repository after the path of an ssh origin remote in URL form", async () => {
    const { exitCode, stdout, stderr, adminApi } = await uploadRepositoryWithOrigin(
      "ssh://git@github.com/ConfigDirector/cli.git",
      projectPath("/repositories/ConfigDirector%2Fcli"),
      { status: 200, body: scannedRepository({ remoteUrl: "ssh://git@github.com/ConfigDirector/cli.git" }) },
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      ...checkoutScanLines,
      "Uploaded the scan of ConfigDirector/cli at 4d40f50 to web-app: 1 reference and 0 dynamic references, with 0 left out for a key that cannot be a config key.",
      "",
    ]);
    expect(uploadedRemotesOf(adminApi)).toEqual([
      {
        path: projectPath("/repositories/ConfigDirector%2Fcli"),
        remoteUrl: "ssh://git@github.com/ConfigDirector/cli.git",
      },
    ]);
  });

  it("names the repository after the whole path of a GitLab origin remote in a subgroup", async () => {
    const { exitCode, stdout, stderr, adminApi } = await uploadRepositoryWithOrigin(
      "https://gitlab.com/group/sub/app.git",
      projectPath("/repositories/group%2Fsub%2Fapp"),
      {
        status: 200,
        body: scannedRepository({ name: "group/sub/app", remoteUrl: "https://gitlab.com/group/sub/app.git" }),
      },
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      ...checkoutScanLines,
      "Uploaded the scan of group/sub/app at 4d40f50 to web-app: 1 reference and 0 dynamic references, with 0 left out for a key that cannot be a config key.",
      "",
    ]);
    expect(uploadedRemotesOf(adminApi)).toEqual([
      {
        path: projectPath("/repositories/group%2Fsub%2Fapp"),
        remoteUrl: "https://gitlab.com/group/sub/app.git",
      },
    ]);
  });

  it("sends an https origin remote without the user and password a CI job checked it out with", async () => {
    const { exitCode, stdout, stderr, adminApi } = await uploadRepositoryWithOrigin(
      "https://gitlab-ci-token:glcbt-64_job-token@gitlab.com/group/app.git",
      projectPath("/repositories/group%2Fapp"),
      {
        status: 200,
        body: scannedRepository({ name: "group/app", remoteUrl: "https://gitlab.com/group/app.git" }),
      },
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      ...checkoutScanLines,
      "Uploaded the scan of group/app at 4d40f50 to web-app: 1 reference and 0 dynamic references, with 0 left out for a key that cannot be a config key.",
      "",
    ]);
    expect(uploadedRemotesOf(adminApi)).toEqual([
      { path: projectPath("/repositories/group%2Fapp"), remoteUrl: "https://gitlab.com/group/app.git" },
    ]);
  });

  it("sends an https origin remote with no user or password exactly as git returns it", async () => {
    const { exitCode, stdout, stderr, adminApi } = await uploadRepositoryWithOrigin(
      "https://GitHub.com/ConfigDirector/cli.git",
      projectPath("/repositories/ConfigDirector%2Fcli"),
      { status: 200, body: scannedRepository({ remoteUrl: "https://GitHub.com/ConfigDirector/cli.git" }) },
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      ...checkoutScanLines,
      "Uploaded the scan of ConfigDirector/cli at 4d40f50 to web-app: 1 reference and 0 dynamic references, with 0 left out for a key that cannot be a config key.",
      "",
    ]);
    expect(uploadedRemotesOf(adminApi)).toEqual([
      {
        path: projectPath("/repositories/ConfigDirector%2Fcli"),
        remoteUrl: "https://GitHub.com/ConfigDirector/cli.git",
      },
    ]);
  });

  it("uploads to the repository named by --repository, still with the origin remote and the commit", async () => {
    const { exitCode, stdout, stderr, adminApi } = await uploadRepositoryWithOrigin(
      "https://github.com/ConfigDirector/cli.git",
      projectPath("/repositories/acme%2Fstorefront"),
      { status: 200, body: scannedRepository({ name: "acme/storefront" }) },
      ["--repository", "acme/storefront"],
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      ...checkoutScanLines,
      "Uploaded the scan of acme/storefront at 4d40f50 to web-app: 1 reference and 0 dynamic references, with 0 left out for a key that cannot be a config key.",
      "",
    ]);
    expect(uploadRequestsOf(adminApi)).toEqual([
      {
        path: projectPath("/repositories/acme%2Fstorefront"),
        body: {
          remoteUrl: "https://github.com/ConfigDirector/cli.git",
          commit: checkoutCommit,
          filesScanned: 1,
          references: [newCheckoutReference],
          dynamicReferences: [],
        },
      },
    ]);
  });

  it("uploads with an empty remote URL and commit to the repository named by --repository outside a git repository", async () => {
    const adminApi = await startUploadAdminApi({
      [projectPath("/repositories/acme%2Fstorefront")]: {
        status: 200,
        body: scannedRepository({ name: "acme/storefront", remoteUrl: "", commit: "" }),
      },
    });
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", checkoutFile);

    const { exitCode, stdout, stderr } = await uploadScan(sandbox, adminApi.baseUrl, [
      "--repository",
      "acme/storefront",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      ...checkoutScanLines,
      "Uploaded the scan of acme/storefront to web-app: 1 reference and 0 dynamic references, with 0 left out for a key that cannot be a config key.",
      "",
    ]);
    expect(uploadRequestsOf(adminApi)).toEqual([
      {
        path: projectPath("/repositories/acme%2Fstorefront"),
        body: {
          remoteUrl: "",
          commit: "",
          filesScanned: 1,
          references: [newCheckoutReference],
          dynamicReferences: [],
        },
      },
    ]);
  });

  it("uploads with the origin remote and an empty commit when the git repository has no commit yet", async () => {
    const adminApi = await startUploadAdminApi({
      [projectPath("/repositories/ConfigDirector%2Fcli")]: {
        status: 200,
        body: scannedRepository({ commit: "" }),
      },
    });
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", checkoutFile);
    await initializeGitRepository(sandbox.workingDirectory);
    await addOriginRemote(sandbox.workingDirectory, "https://github.com/ConfigDirector/cli.git");

    const { exitCode, stdout, stderr } = await uploadScan(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      ...checkoutScanLines,
      "Uploaded the scan of ConfigDirector/cli to web-app: 1 reference and 0 dynamic references, with 0 left out for a key that cannot be a config key.",
      "",
    ]);
    expect(uploadRequestsOf(adminApi)).toEqual([
      {
        path: projectPath("/repositories/ConfigDirector%2Fcli"),
        body: {
          remoteUrl: "https://github.com/ConfigDirector/cli.git",
          commit: "",
          filesScanned: 1,
          references: [newCheckoutReference],
          dynamicReferences: [],
        },
      },
    ]);
  });

  it("reads the origin remote and the commit from the directory of a scanned file", async () => {
    const { exitCode, stdout, stderr, adminApi } = await uploadRepositoryWithOrigin(
      "https://github.com/ConfigDirector/cli.git",
      projectPath("/repositories/ConfigDirector%2Fcli"),
      { status: 200, body: scannedRepository() },
      ["src/checkout.ts"],
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      ...checkoutScanLines,
      "Uploaded the scan of ConfigDirector/cli at 4d40f50 to web-app: 1 reference and 0 dynamic references, with 0 left out for a key that cannot be a config key.",
      "",
    ]);
    expect(uploadRequestsOf(adminApi)).toEqual([
      {
        path: projectPath("/repositories/ConfigDirector%2Fcli"),
        body: {
          remoteUrl: "https://github.com/ConfigDirector/cli.git",
          commit: checkoutCommit,
          filesScanned: 1,
          references: [newCheckoutReference],
          dynamicReferences: [],
        },
      },
    ]);
  });

  it("leaves out and counts a reference whose key cannot be a config key, such as a 3-character key of the project", async () => {
    const adminApi = await startScanAdminApi({
      configs: [projectConfig("new-checkout"), projectConfig("vip")],
      repliesByPath: {
        [projectPath("/repositories/acme%2Fstorefront")]: {
          status: 200,
          body: scannedRepository({ name: "acme/storefront", remoteUrl: "", commit: "", filesScanned: 2 }),
        },
      },
    });
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", checkoutFile);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/plans.ts",
      'export const premiumKeys = ["vip"];\n',
    );

    const { exitCode, stdout, stderr } = await uploadScan(sandbox, adminApi.baseUrl, [
      "--repository",
      "acme/storefront",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "new-checkout",
      "  src/checkout.ts:4 getValue (js-server)",
      "",
      "vip",
      "  src/plans.ts:1 (indirect)",
      "",
      "1 direct, 1 indirect and 0 dynamic references in 2 scanned files.",
      "",
      "Uploaded the scan of acme/storefront to web-app: 1 reference and 0 dynamic references, with 1 left out for a key that cannot be a config key.",
      "",
    ]);
    expect(uploadRequestsOf(adminApi)).toEqual([
      {
        path: projectPath("/repositories/acme%2Fstorefront"),
        body: {
          remoteUrl: "",
          commit: "",
          filesScanned: 2,
          references: [newCheckoutReference],
          dynamicReferences: [],
        },
      },
    ]);
  });

  it("sends direct, indirect, test and dynamic references in the shape scan --json prints them", async () => {
    const adminApi = await startUploadAdminApi({
      [projectPath("/repositories/acme%2Fstorefront")]: {
        status: 200,
        body: scannedRepository({
          name: "acme/storefront",
          remoteUrl: "",
          commit: "",
          filesScanned: 2,
          referenceCount: 2,
          dynamicReferenceCount: 1,
        }),
      },
    });
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      [
        'import { createClient } from "@configdirector/server-sdk";',
        "",
        'const client = createClient("YOUR-SERVER-SDK-KEY");',
        'const NEW_CHECKOUT = "new-checkout";',
        "export const newCheckout = () => client.getValue(NEW_CHECKOUT, false);",
        "export const setting = (key: string) => client.getValue(key, 0);",
        "",
      ].join("\n"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "test/checkout.test.ts",
      'export const fixtureKeys = ["new-checkout"];\n',
    );

    const { exitCode, stdout, stderr } = await uploadScan(sandbox, adminApi.baseUrl, [
      "--repository",
      "acme/storefront",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "new-checkout",
      "  src/checkout.ts:5 getValue(NEW_CHECKOUT) (js-server)",
      "  test/checkout.test.ts:1 (indirect, test)",
      "",
      "Dynamic references (calls whose key is not a string literal)",
      "  src/checkout.ts:6 getValue(key) (js-server)",
      "",
      "1 direct, 1 indirect and 1 dynamic references in 2 scanned files.",
      "",
      "Uploaded the scan of acme/storefront to web-app: 2 references and 1 dynamic reference, with 0 left out for a key that cannot be a config key.",
      "",
    ]);
    expect(uploadRequestsOf(adminApi)).toEqual([
      {
        path: projectPath("/repositories/acme%2Fstorefront"),
        body: {
          remoteUrl: "",
          commit: "",
          filesScanned: 2,
          references: [
            {
              key: "new-checkout",
              file: "src/checkout.ts",
              line: 5,
              kind: "direct",
              sdk: "js-server",
              call: "getValue",
              argument: "NEW_CHECKOUT",
              default: { type: "boolean", value: false },
              test: false,
            },
            { key: "new-checkout", file: "test/checkout.test.ts", line: 1, kind: "indirect", test: true },
          ],
          dynamicReferences: [
            { file: "src/checkout.ts", line: 6, sdk: "js-server", call: "getValue", argument: "key" },
          ],
        },
      },
    ]);
  });

  it("uploads the references to keys configdirector.json lists in ignoreKeys", async () => {
    const adminApi = await startUploadAdminApi({
      [projectPath("/repositories/acme%2Fstorefront")]: {
        status: 200,
        body: scannedRepository({ name: "acme/storefront", remoteUrl: "", commit: "" }),
      },
    });
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", checkoutFile);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "configdirector.json",
      JSON.stringify({ project: "web-app", ignoreKeys: ["new-checkout"] }),
    );

    const { exitCode, stdout, stderr } = await uploadScan(sandbox, adminApi.baseUrl, [
      "--repository",
      "acme/storefront",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      ...checkoutScanLines,
      "Uploaded the scan of acme/storefront to web-app: 1 reference and 0 dynamic references, with 0 left out for a key that cannot be a config key.",
      "",
    ]);
    expect(uploadRequestsOf(adminApi)).toEqual([
      {
        path: projectPath("/repositories/acme%2Fstorefront"),
        body: {
          remoteUrl: "",
          commit: "",
          filesScanned: 1,
          references: [newCheckoutReference],
          dynamicReferences: [],
        },
      },
    ]);
  });

  it("prints the API's response as received, and nothing else, with --json", async () => {
    const { exitCode, stdout, stderr, adminApi } = await uploadRepositoryWithOrigin(
      "https://github.com/ConfigDirector/cli.git",
      projectPath("/repositories/ConfigDirector%2Fcli"),
      { status: 200, body: scannedRepository({ addedByALaterApi: { reason: "kept" } }) },
      ["--json"],
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual(scannedRepository({ addedByALaterApi: { reason: "kept" } }));
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/configs")}`,
      `PUT ${projectPath("/repositories/ConfigDirector%2Fcli")}`,
    ]);
  });
});

describe("scan --upload failures", () => {
  it("exits 2 naming repositories remove when the project holds its maximum of scanned repositories", async () => {
    const { exitCode, stdout, stderr, adminApi } = await uploadConfigDirectorCliRefusedWith({
      status: 400,
      body: {
        error:
          "A project cannot have more than 50 scanned repositories. Remove one before uploading another.",
        code: "REPOSITORY_LIMIT_REACHED",
      },
    });

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The project already holds its maximum of scanned repositories, so the Admin API refused the upload " +
        "(REPOSITORY_LIMIT_REACHED). Remove a repository it no longer needs with " +
        "`configdirector repositories remove <name>`, then upload again.\n",
    );
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/configs")}`,
      `PUT ${projectPath("/repositories/ConfigDirector%2Fcli")}`,
    ]);
  });

  it("exits 2 listing the API's reasons when the API rejects the upload", async () => {
    const { exitCode, stdout, stderr, adminApi } = await uploadConfigDirectorCliRefusedWith({
      status: 400,
      body: {
        errors: [
          { message: "A scan cannot upload more than 10,000 references, dynamic references included" },
        ],
      },
    });

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API rejected the request:\n" +
        "  A scan cannot upload more than 10,000 references, dynamic references included\n",
    );
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/configs")}`,
      `PUT ${projectPath("/repositories/ConfigDirector%2Fcli")}`,
    ]);
  });

  it("exits 2 naming the missing permission when the token cannot update code references", async () => {
    const { exitCode, stdout, stderr, adminApi } = await uploadConfigDirectorCliRefusedWith({
      status: 403,
      body: {
        error: "The API token is missing the `code-references:update` permission.",
        code: "INSUFFICIENT_PERMISSIONS",
      },
    });

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API refused the request: The API token is missing the `code-references:update` permission. (INSUFFICIENT_PERMISSIONS)\n",
    );
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/configs")}`,
      `PUT ${projectPath("/repositories/ConfigDirector%2Fcli")}`,
    ]);
  });
});

describe("scan --upload without a repository name", () => {
  it("exits 2 without a request when the git repository has no origin remote and --repository is not given", async () => {
    const adminApi = await startUploadAdminApi({});
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", checkoutFile);
    await initializeGitRepository(sandbox.workingDirectory);
    await commitEveryFile(sandbox.workingDirectory);

    const { exitCode, stdout, stderr } = await uploadScan(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: scan --upload names the repository after its git remote origin, " +
        "but the git repository in the current directory has no remote named origin. " +
        "Name the repository with --repository <name>.\n",
    );
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request, quoting git, when git finds no repository for the scanned directory and --repository is not given", async () => {
    const adminApi = await startUploadAdminApi({});
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", checkoutFile);

    const { exitCode, stdout, stderr } = await uploadScan(sandbox, adminApi.baseUrl, ["src"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain(
      "Error: scan --upload names the repository after its git remote origin, " +
        "but git cannot read a repository in src (fatal: not a git repository",
    );
    expect(stderr).toContain("). Name the repository with --repository <name>.\n");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when git is not installed and --repository is not given", async () => {
    const adminApi = await startUploadAdminApi({});
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", checkoutFile);
    await createRepositoryWithOrigin(sandbox.workingDirectory, "https://github.com/ConfigDirector/cli.git");
    const directoryWithoutGit = join(sandbox.root, "bin");
    await mkdir(directoryWithoutGit);

    const { exitCode, stdout, stderr } = await uploadScanWithExecutableSearchPath(
      sandbox,
      adminApi.baseUrl,
      directoryWithoutGit,
    );

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: scan --upload names the repository after its git remote origin, " +
        "but git is not installed or not on the PATH. " +
        "Name the repository with --repository <name>.\n",
    );
    expect(adminApi.receivedRequests).toEqual([]);
  });
});

describe("scan --upload of an empty scan", () => {
  it("exits 2 without uploading when the scan read no source file, so the repository keeps its references", async () => {
    const adminApi = await startUploadAdminApi({
      [projectPath("/repositories/acme%2Fstorefront")]: {
        status: 200,
        body: scannedRepository({ name: "acme/storefront", remoteUrl: "", commit: "", filesScanned: 0 }),
      },
    });
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "README.md", "# Storefront\n");

    const { exitCode, stdout, stderr } = await uploadScan(sandbox, adminApi.baseUrl, [
      "--repository",
      "acme/storefront",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: No source files to scan in the current directory, so nothing was uploaded " +
        "and web-app keeps its code references for acme/storefront. " +
        "Check the path given to scan, and include and exclude in configdirector.json.\n",
    );
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `GET ${projectPath("/configs")}`]);
  });

  it("uploads empty references when the scan read source files and found none", async () => {
    const adminApi = await startUploadAdminApi({
      [projectPath("/repositories/acme%2Fstorefront")]: {
        status: 200,
        body: scannedRepository({ name: "acme/storefront", remoteUrl: "", commit: "", referenceCount: 0 }),
      },
    });
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/cart.ts", "export const cartSize = 3;\n");

    const { exitCode, stdout, stderr } = await uploadScan(sandbox, adminApi.baseUrl, [
      "--repository",
      "acme/storefront",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "0 direct, 0 indirect and 0 dynamic references in 1 scanned file.",
      "",
      "Uploaded the scan of acme/storefront to web-app: 0 references and 0 dynamic references, with 0 left out for a key that cannot be a config key.",
      "",
    ]);
    expect(uploadRequestsOf(adminApi)).toEqual([
      {
        path: projectPath("/repositories/acme%2Fstorefront"),
        body: { remoteUrl: "", commit: "", filesScanned: 1, references: [], dynamicReferences: [] },
      },
    ]);
  });
});
