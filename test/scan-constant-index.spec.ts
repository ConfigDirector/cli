import { describe, expect, it } from "vitest";
import { projectConfig } from "./support/scan-admin-api.js";
import { scanRepositoryJson, scanRepositoryText, serverSdkSetup } from "./support/scan-repository.js";

const directReference = (key: string, argument: string, file: string, line: number) => ({
  key,
  argument,
  file,
  line,
  kind: "direct",
  sdk: "js-server",
  call: "getValue",
  default: { type: "boolean", value: false },
  test: false,
});

const referencedKeys = (output: { references: Array<{ key: string; argument?: string }> }) =>
  output.references.map((reference) => [reference.key, reference.argument]);

const dynamicArguments = (output: { dynamicReferences: Array<{ argument: string }> }) =>
  output.dynamicReferences.map((reference) => reference.argument);

describe("scan constants", () => {
  it("resolves a constant defined in another file to a direct reference that names the constant", async () => {
    const { exitCode, output } = await scanRepositoryJson({
      "src/flags.ts": ['export const NEW_CHECKOUT_FLAG = "new-checkout";'],
      "src/checkout.ts": [
        ...serverSdkSetup,
        'import { NEW_CHECKOUT_FLAG } from "./flags";',
        "",
        "export const checkout = () => client.getValue(NEW_CHECKOUT_FLAG, false);",
      ],
    });

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([
      directReference("new-checkout", "NEW_CHECKOUT_FLAG", "src/checkout.ts", 6),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("resolves two constants whose names are unlike their keys to their own keys", async () => {
    const { exitCode, output } = await scanRepositoryJson({
      "src/checkout.ts": [
        ...serverSdkSetup,
        'const NEW_CHECKOUT_FLAG = "checkout-redesign";',
        'const CHECKOUT_V2_FLAG = "checkout-v2-rollout";',
        "",
        "export const newCheckout = () => client.getValue(NEW_CHECKOUT_FLAG, false);",
        "export const checkoutV2 = () => client.getValue(CHECKOUT_V2_FLAG, false);",
      ],
    });

    expect(exitCode).toEqual(0);
    expect(referencedKeys(output)).toEqual([
      ["checkout-redesign", "NEW_CHECKOUT_FLAG"],
      ["checkout-v2-rollout", "CHECKOUT_V2_FLAG"],
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("resolves a property of an object literal read through a dotted path", async () => {
    const { exitCode, output } = await scanRepositoryJson({
      "src/flags.ts": [
        "export const FLAGS = {",
        '  checkoutV2: "new-checkout",',
        '  darkMode: "dark-mode",',
        "} as const;",
      ],
      "src/checkout.ts": [
        ...serverSdkSetup,
        'import { FLAGS } from "./flags";',
        "",
        "export const checkout = () => client.getValue(FLAGS.checkoutV2, false);",
      ],
    });

    expect(exitCode).toEqual(0);
    expect(referencedKeys(output)).toEqual([["new-checkout", "FLAGS.checkoutV2"]]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("resolves a constant declared with a type annotation", async () => {
    const { exitCode, output } = await scanRepositoryJson({
      "src/checkout.ts": [
        ...serverSdkSetup,
        'const NEW_CHECKOUT_FLAG: string = "new-checkout";',
        "",
        "export const checkout = () => client.getValue(NEW_CHECKOUT_FLAG, false);",
      ],
    });

    expect(exitCode).toEqual(0);
    expect(referencedKeys(output)).toEqual([["new-checkout", "NEW_CHECKOUT_FLAG"]]);
  });

  it("resolves a Swift enum case read through rawValue", async () => {
    const { exitCode, output } = await scanRepositoryJson({
      "Sources/App/Flag.swift": ["enum Flag: String {", '    case newCheckout = "new-checkout"', "}"],
      "Sources/App/Checkout.swift": [
        "import ConfigDirector",
        "",
        'let client = try! ConfigDirectorClient(clientSDKKey: "YOUR-CLIENT-SDK-KEY")',
        "let newCheckout = client.value(for: Flag.newCheckout.rawValue, default: false)",
      ],
    });

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([
      {
        key: "new-checkout",
        argument: "Flag.newCheckout.rawValue",
        file: "Sources/App/Checkout.swift",
        line: 4,
        kind: "direct",
        sdk: "swift",
        call: "value",
        default: { type: "boolean", value: false },
        test: false,
      },
    ]);
  });

  it("resolves a Kotlin object property", async () => {
    const { exitCode, output } = await scanRepositoryJson({
      "src/main/kotlin/Flags.kt": ["object Flags {", '    const val NEW_CHECKOUT = "new-checkout"', "}"],
      "src/main/kotlin/Checkout.kt": [
        "import com.configdirector.ConfigDirectorClient",
        "",
        "fun newCheckout(client: ConfigDirectorClient) = client.getBoolean(Flags.NEW_CHECKOUT, false)",
      ],
    });

    expect(exitCode).toEqual(0);
    expect(referencedKeys(output)).toEqual([["new-checkout", "Flags.NEW_CHECKOUT"]]);
  });

  it("resolves a Go constant from a const block", async () => {
    const { exitCode, output } = await scanRepositoryJson({
      "go.mod": ["module example.com/app", "", "go 1.22"],
      "flags.go": ["package main", "", "const (", '\tNewCheckout = "new-checkout"', ")"],
      "main.go": [
        "package main",
        "",
        'import "github.com/ConfigDirector/go-sdks/configdirector"',
        "",
        "func main() {",
        '\tclient, _ := configdirector.NewClient("YOUR-SERVER-SDK-KEY")',
        "\tclient.BoolValue(NewCheckout, false, nil)",
        "}",
      ],
    });

    expect(exitCode).toEqual(0);
    expect(referencedKeys(output)).toEqual([["new-checkout", "NewCheckout"]]);
  });

  it("resolves a Go short variable declaration", async () => {
    const { exitCode, output } = await scanRepositoryJson({
      "main.go": [
        "package main",
        "",
        'import "github.com/ConfigDirector/go-sdks/configdirector"',
        "",
        "func main() {",
        '\tclient, _ := configdirector.NewClient("YOUR-SERVER-SDK-KEY")',
        '\tdarkMode := "dark-mode"',
        "\tclient.BoolValue(darkMode, false, nil)",
        "}",
      ],
    });

    expect(exitCode).toEqual(0);
    expect(referencedKeys(output)).toEqual([["dark-mode", "darkMode"]]);
  });

  it("resolves a Python module constant", async () => {
    const { exitCode, output } = await scanRepositoryJson({
      "app/flags.py": ['NEW_CHECKOUT = "new-checkout"'],
      "app/checkout.py": [
        "from configdirector import Client",
        "from app.flags import NEW_CHECKOUT",
        "",
        'client = Client("YOUR-SERVER-SDK-KEY")',
        "new_checkout = client.get_value(NEW_CHECKOUT, False)",
      ],
    });

    expect(exitCode).toEqual(0);
    expect(referencedKeys(output)).toEqual([["new-checkout", "NEW_CHECKOUT"]]);
  });

  it("resolves a computed key of a test client's values", async () => {
    const { exitCode, output } = await scanRepositoryJson({
      "test/checkout.test.ts": [
        'import { createTestClient } from "@configdirector/server-sdk/testing";',
        'import { NEW_CHECKOUT_FLAG } from "../src/flags";',
        "",
        "const testClient = createTestClient({ values: { [NEW_CHECKOUT_FLAG]: true } });",
      ],
      "src/flags.ts": ['export const NEW_CHECKOUT_FLAG = "new-checkout";'],
    });

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([
      {
        key: "new-checkout",
        argument: "[NEW_CHECKOUT_FLAG]",
        file: "test/checkout.test.ts",
        line: 4,
        kind: "direct",
        sdk: "js-server",
        call: "createTestClient",
        test: true,
      },
    ]);
  });

  it("reports a call through an identifier assigned two different literals as dynamic", async () => {
    const { exitCode, output } = await scanRepositoryJson({
      "src/web/flags.ts": ['export const CHECKOUT_FLAG = "new-checkout";'],
      "src/mobile/flags.ts": ['export const CHECKOUT_FLAG = "mobile-checkout";'],
      "src/checkout.ts": [
        ...serverSdkSetup,
        'import { CHECKOUT_FLAG } from "./web/flags";',
        "",
        "export const checkout = () => client.getValue(CHECKOUT_FLAG, false);",
      ],
    });

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(dynamicArguments(output)).toEqual(["CHECKOUT_FLAG"]);
  });

  it("reports a call through a renamed import of a constant as dynamic", async () => {
    const { exitCode, output } = await scanRepositoryJson({
      "src/flags.ts": ['export const NEW_CHECKOUT_FLAG = "new-checkout";'],
      "src/checkout.ts": [
        ...serverSdkSetup,
        'import { NEW_CHECKOUT_FLAG as FLAG } from "./flags";',
        "",
        "export const checkout = () => client.getValue(FLAG, false);",
      ],
    });

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(dynamicArguments(output)).toEqual(["FLAG"]);
  });

  it("resolves a C# const string", async () => {
    const { exitCode, output } = await scanRepositoryJson({
      "Flags.cs": [
        "public static class Flags",
        "{",
        '    public const string NewCheckout = "new-checkout";',
        "}",
      ],
      "Checkout.cs": [
        "using ConfigDirector;",
        "",
        "public class Checkout(ConfigDirectorClient client)",
        "{",
        "    public bool IsNew() => client.GetValue(Flags.NewCheckout, false);",
        "}",
      ],
    });

    expect(exitCode).toEqual(0);
    expect(referencedKeys(output)).toEqual([["new-checkout", "Flags.NewCheckout"]]);
  });

  it("reports a call through an alias of a constant as dynamic", async () => {
    const { exitCode, output } = await scanRepositoryJson({
      "src/checkout.ts": [
        ...serverSdkSetup,
        'const NEW_CHECKOUT_FLAG = "new-checkout";',
        "const FLAG = NEW_CHECKOUT_FLAG;",
        "",
        "export const checkout = () => client.getValue(FLAG, false);",
      ],
    });

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(dynamicArguments(output)).toEqual(["FLAG"]);
  });

  it("reports a call through an identifier assigned a template string as dynamic", async () => {
    const { exitCode, output } = await scanRepositoryJson({
      "src/checkout.ts": [
        ...serverSdkSetup,
        "const region = process.env.REGION;",
        "const BANNER_FLAG = `banner-${region}`;",
        "",
        "export const banner = () => client.getValue(BANNER_FLAG, false);",
      ],
    });

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(dynamicArguments(output)).toEqual(["BANNER_FLAG"]);
  });

  it("reports a call through an identifier assigned a concatenation as dynamic", async () => {
    const { exitCode, output } = await scanRepositoryJson({
      "src/checkout.ts": [
        ...serverSdkSetup,
        "const region = process.env.REGION;",
        'const CHECKOUT_FLAG = "checkout-" + region;',
        "",
        "export const checkout = () => client.getValue(CHECKOUT_FLAG, false);",
      ],
    });

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(dynamicArguments(output)).toEqual(["CHECKOUT_FLAG"]);
  });

  it("does not report the definition of a resolved constant as an indirect reference", async () => {
    const { exitCode, output } = await scanRepositoryJson(
      {
        "src/flags.ts": ['export const NEW_CHECKOUT_FLAG = "new-checkout";'],
        "src/checkout.ts": [
          ...serverSdkSetup,
          'import { NEW_CHECKOUT_FLAG } from "./flags";',
          "",
          "export const checkout = () => client.getValue(NEW_CHECKOUT_FLAG, false);",
        ],
      },
      [projectConfig("new-checkout")],
    );

    expect(exitCode).toEqual(0);
    expect(
      output.references.map((reference: { file: string; kind: string }) => [reference.file, reference.kind]),
    ).toEqual([["src/checkout.ts", "direct"]]);
  });

  it("reports the definition of a constant no SDK call reads as an indirect reference", async () => {
    const { exitCode, output } = await scanRepositoryJson(
      {
        "src/flags.ts": ['export const NEW_CHECKOUT_FLAG = "new-checkout";'],
        "src/checkout.ts": [
          'import { isEnabled } from "./wrapper";',
          'import { NEW_CHECKOUT_FLAG } from "./flags";',
          "",
          "export const checkout = () => isEnabled(NEW_CHECKOUT_FLAG);",
        ],
      },
      [projectConfig("new-checkout")],
    );

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([
      { key: "new-checkout", file: "src/flags.ts", line: 1, kind: "indirect", test: false },
    ]);
  });

  it("prints the constant a direct reference was resolved from after the call", async () => {
    const { exitCode, stdout } = await scanRepositoryText({
      "src/checkout.ts": [
        ...serverSdkSetup,
        'const NEW_CHECKOUT_FLAG = "new-checkout";',
        "",
        "export const checkout = () => client.getValue(NEW_CHECKOUT_FLAG, false);",
      ],
    });

    expect(exitCode).toEqual(0);
    expect(stdout).toEqual(
      [
        "new-checkout",
        "  src/checkout.ts:6 getValue(NEW_CHECKOUT_FLAG) (js-server)",
        "",
        "1 direct, 0 indirect and 0 dynamic references in 1 scanned file.",
        "",
      ].join("\n"),
    );
  });
});
