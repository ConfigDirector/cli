import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { writeRepositoryFile } from "./support/repository-files.js";
import { createSandbox } from "./support/sandbox.js";
import { projectConfig, startScanAdminApi, webApp } from "./support/scan-admin-api.js";

const scanJsonOf = async (
  files: Record<string, string>,
  commandLineArguments: string[] = [],
  project = webApp,
) => {
  const adminApi = await startScanAdminApi({ configs: [projectConfig("new-checkout")], projects: [project] });
  const sandbox = await createSandbox();
  for (const [path, contents] of Object.entries(files)) {
    await writeRepositoryFile(sandbox.workingDirectory, path, contents);
  }
  const invocation = sandbox.invocation({
    commandLineArguments: [
      "scan",
      "--project",
      "web-app",
      "--token",
      "cd_flag_token",
      "--json",
      ...commandLineArguments,
    ],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
  });

  const exitCode = await run(invocation);

  const stdout = invocation.stdout.text();
  return {
    exitCode,
    stdout,
    stderr: invocation.stderr.text(),
    output: stdout === "" ? undefined : JSON.parse(stdout),
    adminApi,
  };
};

const checkoutPathFile = [
  'import { createClient } from "@configdirector/server-sdk";',
  "",
  'const client = createClient("YOUR-SERVER-SDK-KEY");',
  "",
  "export const checkoutPath = () => {",
  '  const newCheckout = client.getValue("new-checkout", false);',
  '  return newCheckout ? "/checkout/v2" : "/checkout";',
  "};",
  "",
].join("\n");

const newCheckoutReferenceWithoutSnippet = {
  key: "new-checkout",
  file: "src/checkout.ts",
  line: 6,
  kind: "direct",
  sdk: "js-server",
  call: "getValue",
  default: { type: "boolean", value: false },
  test: false,
};

describe("scan snippets", () => {
  it("includes the reference line with the 2 lines before and after it by default", async () => {
    const { exitCode, stderr, output } = await scanJsonOf({ "src/checkout.ts": checkoutPathFile });

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(output.references).toEqual([
      {
        ...newCheckoutReferenceWithoutSnippet,
        snippet: {
          firstLine: 4,
          lines: [
            "",
            "export const checkoutPath = () => {",
            '  const newCheckout = client.getValue("new-checkout", false);',
            '  return newCheckout ? "/checkout/v2" : "/checkout";',
            "};",
          ],
          language: "typescript",
          truncatedLines: [],
        },
      },
    ]);
  });

  it("starts the snippet of a reference on the first line at that line", async () => {
    const { exitCode, output } = await scanJsonOf({
      "src/checkout-flags.ts": [
        'export const CHECKOUT_FLAG_KEYS = ["new-checkout"];',
        "",
        "export const isCheckoutFlag = (key: string) => CHECKOUT_FLAG_KEYS.includes(key);",
        "",
        "export const checkoutFlagCount = CHECKOUT_FLAG_KEYS.length;",
        "",
      ].join("\n"),
    });

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([
      {
        key: "new-checkout",
        file: "src/checkout-flags.ts",
        line: 1,
        kind: "indirect",
        test: false,
        snippet: {
          firstLine: 1,
          lines: [
            'export const CHECKOUT_FLAG_KEYS = ["new-checkout"];',
            "",
            "export const isCheckoutFlag = (key: string) => CHECKOUT_FLAG_KEYS.includes(key);",
          ],
          language: "typescript",
          truncatedLines: [],
        },
      },
    ]);
  });

  it("ends the snippet of a reference on the last line at that line", async () => {
    const { exitCode, output } = await scanJsonOf({
      "src/checkout.ts": [
        'import { createClient } from "@configdirector/server-sdk";',
        "",
        'const client = createClient("YOUR-SERVER-SDK-KEY");',
        "",
        'export const newCheckout = () => client.getValue("new-checkout", false);',
        "",
      ].join("\n"),
    });

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([
      {
        ...newCheckoutReferenceWithoutSnippet,
        line: 5,
        snippet: {
          firstLine: 3,
          lines: [
            'const client = createClient("YOUR-SERVER-SDK-KEY");',
            "",
            'export const newCheckout = () => client.getValue("new-checkout", false);',
          ],
          language: "typescript",
          truncatedLines: [],
        },
      },
    ]);
  });

  it("includes the reference line alone with --context-lines 0", async () => {
    const { exitCode, stderr, output } = await scanJsonOf({ "src/checkout.ts": checkoutPathFile }, [
      "--context-lines",
      "0",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(output.references).toEqual([
      {
        ...newCheckoutReferenceWithoutSnippet,
        snippet: {
          firstLine: 6,
          lines: ['  const newCheckout = client.getValue("new-checkout", false);'],
          language: "typescript",
          truncatedLines: [],
        },
      },
    ]);
  });

  it("includes the reference line with the 5 lines before and after it with --context-lines 5", async () => {
    const { exitCode, stderr, output } = await scanJsonOf(
      {
        "src/checkout.ts": [
          'import { createClient } from "@configdirector/server-sdk";',
          "",
          'const client = createClient("YOUR-SERVER-SDK-KEY");',
          "",
          "export const checkoutPath = (cartTotal: number) => {",
          "  const freeShipping = cartTotal >= 50;",
          '  const newCheckout = client.getValue("new-checkout", false);',
          "  if (newCheckout && freeShipping) {",
          '    return "/checkout/v2?shipping=free";',
          "  }",
          '  return newCheckout ? "/checkout/v2" : "/checkout";',
          "};",
          "",
          'export const cartPath = () => "/cart";',
          "",
        ].join("\n"),
      },
      ["--context-lines", "5"],
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(output.references).toEqual([
      {
        ...newCheckoutReferenceWithoutSnippet,
        line: 7,
        snippet: {
          firstLine: 2,
          lines: [
            "",
            'const client = createClient("YOUR-SERVER-SDK-KEY");',
            "",
            "export const checkoutPath = (cartTotal: number) => {",
            "  const freeShipping = cartTotal >= 50;",
            '  const newCheckout = client.getValue("new-checkout", false);',
            "  if (newCheckout && freeShipping) {",
            '    return "/checkout/v2?shipping=free";',
            "  }",
            '  return newCheckout ? "/checkout/v2" : "/checkout";',
            "};",
          ],
          language: "typescript",
          truncatedLines: [],
        },
      },
    ]);
  });

  it("cuts a line longer than 250 characters to its first 250 and lists it as truncated", async () => {
    const keptPart = 'export const newCheckout = () => client.getValue("new-checkout", false); // '.padEnd(
      250,
      "=",
    );
    const cutPart = "=".repeat(50);

    const { exitCode, output } = await scanJsonOf({
      "src/checkout.ts": [
        'import { createClient } from "@configdirector/server-sdk";',
        "",
        'const client = createClient("YOUR-SERVER-SDK-KEY");',
        "",
        `${keptPart}${cutPart}`,
        "",
      ].join("\n"),
    });

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([
      {
        ...newCheckoutReferenceWithoutSnippet,
        line: 5,
        snippet: {
          firstLine: 3,
          lines: ['const client = createClient("YOUR-SERVER-SDK-KEY");', "", keptPart],
          language: "typescript",
          truncatedLines: [5],
        },
      },
    ]);
  });

  it("keeps a line of exactly 250 characters whole", async () => {
    const longestKeptLine =
      'export const newCheckout = () => client.getValue("new-checkout", false); // '.padEnd(250, "=");

    const { exitCode, output } = await scanJsonOf({
      "src/checkout.ts": [
        'import { createClient } from "@configdirector/server-sdk";',
        "",
        'const client = createClient("YOUR-SERVER-SDK-KEY");',
        "",
        longestKeptLine,
        "",
      ].join("\n"),
    });

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([
      {
        ...newCheckoutReferenceWithoutSnippet,
        line: 5,
        snippet: {
          firstLine: 3,
          lines: ['const client = createClient("YOUR-SERVER-SDK-KEY");', "", longestKeptLine],
          language: "typescript",
          truncatedLines: [],
        },
      },
    ]);
  });

  it("includes the lines of a file with Windows line endings without their carriage returns", async () => {
    const { exitCode, output } = await scanJsonOf({
      "src/checkout.ts": checkoutPathFile.replaceAll("\n", "\r\n"),
    });

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([
      {
        ...newCheckoutReferenceWithoutSnippet,
        snippet: {
          firstLine: 4,
          lines: [
            "",
            "export const checkoutPath = () => {",
            '  const newCheckout = client.getValue("new-checkout", false);',
            '  return newCheckout ? "/checkout/v2" : "/checkout";',
            "};",
          ],
          language: "typescript",
          truncatedLines: [],
        },
      },
    ]);
  });

  it("names the language of a .ts file typescript", async () => {
    const { exitCode, output } = await scanJsonOf({
      "src/checkout.ts": [
        'import { createClient } from "@configdirector/server-sdk";',
        'const client = createClient("YOUR-SERVER-SDK-KEY");',
        'export const newCheckout = () => client.getValue("new-checkout", false);',
        "",
      ].join("\n"),
    });

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([
      {
        ...newCheckoutReferenceWithoutSnippet,
        line: 3,
        snippet: {
          firstLine: 1,
          lines: [
            'import { createClient } from "@configdirector/server-sdk";',
            'const client = createClient("YOUR-SERVER-SDK-KEY");',
            'export const newCheckout = () => client.getValue("new-checkout", false);',
          ],
          language: "typescript",
          truncatedLines: [],
        },
      },
    ]);
  });

  it("names the language of a .vue file vue", async () => {
    const { exitCode, output } = await scanJsonOf({
      "src/CheckoutButton.vue": [
        '<script setup lang="ts">',
        'import { useConfigValue } from "@configdirector/vue-sdk";',
        "",
        'const { value: newCheckout } = useConfigValue("new-checkout", false);',
        "</script>",
        "",
        "<template>",
        "  <a :href=\"newCheckout ? '/checkout/v2' : '/checkout'\">Check out</a>",
        "</template>",
        "",
      ].join("\n"),
    });

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([
      {
        key: "new-checkout",
        file: "src/CheckoutButton.vue",
        line: 4,
        kind: "direct",
        sdk: "vue",
        call: "useConfigValue",
        default: { type: "boolean", value: false },
        test: false,
        snippet: {
          firstLine: 2,
          lines: [
            'import { useConfigValue } from "@configdirector/vue-sdk";',
            "",
            'const { value: newCheckout } = useConfigValue("new-checkout", false);',
            "</script>",
            "",
          ],
          language: "vue",
          truncatedLines: [],
        },
      },
    ]);
  });

  it("includes a snippet around an indirect reference", async () => {
    const { exitCode, output } = await scanJsonOf({
      "src/cart.ts": [
        'import { isEnabled } from "./flags";',
        "",
        "export const cartActions = () => [",
        '  isEnabled("new-checkout") ? "express-checkout" : "checkout",',
        '  "save-for-later",',
        "];",
        "",
      ].join("\n"),
    });

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([
      {
        key: "new-checkout",
        file: "src/cart.ts",
        line: 4,
        kind: "indirect",
        test: false,
        snippet: {
          firstLine: 2,
          lines: [
            "",
            "export const cartActions = () => [",
            '  isEnabled("new-checkout") ? "express-checkout" : "checkout",',
            '  "save-for-later",',
            "];",
          ],
          language: "typescript",
          truncatedLines: [],
        },
      },
    ]);
  });

  it("includes no snippet with a dynamic reference", async () => {
    const { exitCode, output } = await scanJsonOf({
      "src/settings.ts": [
        'import { createClient } from "@configdirector/server-sdk";',
        "",
        'const client = createClient("YOUR-SERVER-SDK-KEY");',
        "",
        "export const settingValue = (settingKey: string) => client.getValue(settingKey, false);",
        "",
      ].join("\n"),
    });

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([
      { file: "src/settings.ts", line: 5, sdk: "js-server", call: "getValue", argument: "settingKey" },
    ]);
  });

  it("includes snippets without --upload even when the project stores none", async () => {
    const { exitCode, output } = await scanJsonOf({ "src/checkout.ts": checkoutPathFile }, [], {
      ...webApp,
      storeCodeSnippets: false,
    });

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([
      {
        ...newCheckoutReferenceWithoutSnippet,
        snippet: {
          firstLine: 4,
          lines: [
            "",
            "export const checkoutPath = () => {",
            '  const newCheckout = client.getValue("new-checkout", false);',
            '  return newCheckout ? "/checkout/v2" : "/checkout";',
            "};",
          ],
          language: "typescript",
          truncatedLines: [],
        },
      },
    ]);
  });

  it("includes no snippet with --no-snippets", async () => {
    const { exitCode, stderr, output } = await scanJsonOf({ "src/checkout.ts": checkoutPathFile }, [
      "--no-snippets",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(output.references).toEqual([newCheckoutReferenceWithoutSnippet]);
  });

  it("exits 2 without a request when --context-lines is more than 5", async () => {
    const { exitCode, stdout, stderr, adminApi } = await scanJsonOf({ "src/checkout.ts": checkoutPathFile }, [
      "--context-lines",
      "6",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual("Error: --context-lines takes a whole number from 0 to 5, not 6.\n");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when --context-lines is not a whole number", async () => {
    const { exitCode, stdout, stderr, adminApi } = await scanJsonOf({ "src/checkout.ts": checkoutPathFile }, [
      "--context-lines",
      "1.5",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual("Error: --context-lines takes a whole number from 0 to 5, not 1.5.\n");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when --no-snippets is combined with --context-lines", async () => {
    const { exitCode, stdout, stderr, adminApi } = await scanJsonOf({ "src/checkout.ts": checkoutPathFile }, [
      "--no-snippets",
      "--context-lines",
      "3",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("option '--context-lines <number>' cannot be used with option '--no-snippets'");
    expect(adminApi.receivedRequests).toEqual([]);
  });
});
