import { readdir, readFile } from "node:fs/promises";
import { defineConfig, type TsdownPlugin } from "tsdown";

const bundledPackages = ["commander", "ignore", "picomatch", "valibot"];

const licenseSection = async (packageName: string) => {
  const packageDirectory = new URL(`./node_modules/${packageName}/`, import.meta.url);
  const { version } = JSON.parse(await readFile(new URL("package.json", packageDirectory), "utf8"));
  const licenseFileName = (await readdir(packageDirectory))
    .sort()
    .find((fileName) => /^licen[cs]e/i.test(fileName));
  if (licenseFileName === undefined) {
    throw new Error(`${packageName} has no license file to ship with the bundle.`);
  }
  const licenseText = await readFile(new URL(licenseFileName, packageDirectory), "utf8");
  return `## ${packageName} ${version}\n\n${licenseText}`;
};

const thirdPartyLicenses: TsdownPlugin = {
  name: "third-party-licenses",
  async generateBundle() {
    const licenseSections = await Promise.all(bundledPackages.map(licenseSection));
    this.emitFile({
      type: "asset",
      fileName: "THIRD-PARTY-LICENSES.md",
      source: [
        "# Third-party licenses",
        "`@configdirector/cli` includes the code of these packages.",
        ...licenseSections,
      ].join("\n\n"),
    });
  },
};

export default defineConfig({
  entry: { configdirector: "src/main.ts" },
  format: "esm",
  platform: "node",
  target: "node20",
  clean: true,
  dts: false,
  sourcemap: false,
  deps: { onlyBundle: bundledPackages },
  plugins: [thirdPartyLicenses],
});
