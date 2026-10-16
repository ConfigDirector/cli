import { describe, expect, it } from "vitest";
import { projectConfig } from "./support/scan-admin-api.js";
import { scanRepositoryJson, serverSdkSetup } from "./support/scan-repository.js";

const indirectReference = (key: string, file: string, line: number, test = false) => ({
  key,
  file,
  line,
  kind: "indirect",
  test,
});

const referenceLines = (output: { references: Array<{ line: number }> }) =>
  output.references.map((reference) => reference.line);

const referenceKinds = (output: { references: Array<{ kind: string }> }) =>
  output.references.map((reference) => reference.kind);

const scanQuotedKeyIn = async (file: string) => {
  const { exitCode, output } = await scanRepositoryJson({ [file]: ['seed("new-checkout");'] }, [
    projectConfig("new-checkout"),
  ]);
  return { exitCode, references: output.references };
};

describe("scan known keys as text", () => {
  it("reports a wrapper call passing one of the project's keys as an indirect reference", async () => {
    const { exitCode, output } = await scanRepositoryJson(
      {
        "src/checkout.ts": [
          'import { isEnabled } from "./flags";',
          "",
          'export const checkout = () => isEnabled("new-checkout");',
        ],
      },
      [projectConfig("new-checkout")],
    );

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([indirectReference("new-checkout", "src/checkout.ts", 3)]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("reports a quoted deprecated key as an indirect reference to the deprecated key", async () => {
    const { exitCode, output } = await scanRepositoryJson(
      { "src/checkout.ts": ['export const flagKeys = ["checkout-v2"];'] },
      [projectConfig("new-checkout", ["checkout-v2"])],
    );

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([indirectReference("checkout-v2", "src/checkout.ts", 1)]);
  });

  it("reports nothing for a quoted string that is not one of the project's keys", async () => {
    const { exitCode, output } = await scanRepositoryJson(
      { "src/checkout.ts": ['export const flagKeys = ["old-checkout", "new-checkout-v2"];'] },
      [projectConfig("new-checkout")],
    );

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
  });

  it("finds a key quoted with single quotes", async () => {
    const { exitCode, output } = await scanRepositoryJson(
      { "src/checkout.ts": ["export const checkout = isEnabled('new-checkout');"] },
      [projectConfig("new-checkout")],
    );

    expect(exitCode).toEqual(0);
    expect(referenceLines(output)).toEqual([1]);
  });

  it("finds a key quoted with backticks", async () => {
    const { exitCode, output } = await scanRepositoryJson(
      { "src/checkout.ts": ["export const checkout = isEnabled(`new-checkout`);"] },
      [projectConfig("new-checkout")],
    );

    expect(exitCode).toEqual(0);
    expect(referenceLines(output)).toEqual([1]);
  });

  it("reports nothing for a key inside a template string with a placeholder", async () => {
    const { exitCode, output } = await scanRepositoryJson(
      { "src/checkout.ts": ["export const checkout = isEnabled(`new-checkout-${region}`);"] },
      [projectConfig("new-checkout")],
    );

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
  });

  it("does not count the key literal of an SDK call as an indirect reference as well", async () => {
    const { exitCode, output } = await scanRepositoryJson(
      {
        "src/checkout.ts": [
          ...serverSdkSetup,
          'export const checkout = () => client.getValue("new-checkout", false);',
        ],
      },
      [projectConfig("new-checkout")],
    );

    expect(exitCode).toEqual(0);
    expect(referenceKinds(output)).toEqual(["direct"]);
  });

  it("does not count the keys of a test client's values as indirect references as well", async () => {
    const { exitCode, output } = await scanRepositoryJson(
      {
        "test/checkout.test.ts": [
          'import { createTestClient } from "@configdirector/server-sdk/testing";',
          "",
          'const testClient = createTestClient({ values: { "new-checkout": true } });',
        ],
      },
      [projectConfig("new-checkout")],
    );

    expect(exitCode).toEqual(0);
    expect(referenceKinds(output)).toEqual(["direct"]);
  });

  it("marks an indirect reference in a test directory as a test", async () => {
    const { exitCode, references } = await scanQuotedKeyIn("test/checkout.ts");

    expect(exitCode).toEqual(0);
    expect(references).toEqual([indirectReference("new-checkout", "test/checkout.ts", 1, true)]);
  });

  it("marks an indirect reference in a file named .test as a test", async () => {
    const { exitCode, references } = await scanQuotedKeyIn("src/checkout.test.ts");

    expect(exitCode).toEqual(0);
    expect(references).toEqual([indirectReference("new-checkout", "src/checkout.test.ts", 1, true)]);
  });

  it("marks an indirect reference in a Go _test file as a test", async () => {
    const { exitCode, references } = await scanQuotedKeyIn("src/checkout_test.go");

    expect(exitCode).toEqual(0);
    expect(references).toEqual([indirectReference("new-checkout", "src/checkout_test.go", 1, true)]);
  });

  it("marks an indirect reference in a Python test_ file as a test", async () => {
    const { exitCode, references } = await scanQuotedKeyIn("src/test_checkout.py");

    expect(exitCode).toEqual(0);
    expect(references).toEqual([indirectReference("new-checkout", "src/test_checkout.py", 1, true)]);
  });

  it("marks an indirect reference in a file named after a Tests class as a test", async () => {
    const { exitCode, references } = await scanQuotedKeyIn("src/CheckoutTests.cs");

    expect(exitCode).toEqual(0);
    expect(references).toEqual([indirectReference("new-checkout", "src/CheckoutTests.cs", 1, true)]);
  });

  it("does not mark an indirect reference in a source file as a test", async () => {
    const { exitCode, references } = await scanQuotedKeyIn("src/checkout.ts");

    expect(exitCode).toEqual(0);
    expect(references).toEqual([indirectReference("new-checkout", "src/checkout.ts", 1)]);
  });

  it("does not mark a file whose name only ends in the letters test as a test", async () => {
    const { exitCode, references } = await scanQuotedKeyIn("src/latest.ts");

    expect(exitCode).toEqual(0);
    expect(references).toEqual([indirectReference("new-checkout", "src/latest.ts", 1)]);
  });

  it("reports an indirect reference in a file that imports no SDK", async () => {
    const { exitCode, output } = await scanRepositoryJson(
      { "docs/flags.py": ['FLAG_KEYS = ["new-checkout"]'] },
      [projectConfig("new-checkout")],
    );

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([indirectReference("new-checkout", "docs/flags.py", 1)]);
  });
});
