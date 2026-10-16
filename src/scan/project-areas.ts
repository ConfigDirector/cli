import { join, relative, sep } from "node:path";
import { fileExists, readFileIfPresent } from "../file-contents.js";
import { NearestDeclarations } from "./nearest-declarations.js";

export type ProjectArea = "android-module" | "jvm-module" | "nuxt-app" | "nuxt-server";

type BuildModule = "android" | "jvm";

const GRADLE_BUILD_FILES = ["build.gradle.kts", "build.gradle"];
const MAVEN_BUILD_FILE = "pom.xml";
const ANDROID_MODULE_MARKERS = ["com.android.", "android {", "android{"];
const NUXT_CONFIG_FILES = ["nuxt.config.ts", "nuxt.config.js", "nuxt.config.mjs", "nuxt.config.mts"];
const NUXT_SERVER_DIRECTORY = "server";

const buildModuleDeclaredIn = async (directory: string): Promise<BuildModule | undefined> => {
  for (const buildFile of GRADLE_BUILD_FILES) {
    const contents = await readFileIfPresent(join(directory, buildFile));
    if (contents !== undefined) {
      return ANDROID_MODULE_MARKERS.some((marker) => contents.includes(marker)) ? "android" : "jvm";
    }
  }
  return (await readFileIfPresent(join(directory, MAVEN_BUILD_FILE))) === undefined ? undefined : "jvm";
};

const nuxtAppRootDeclaredIn = async (directory: string): Promise<string | undefined> => {
  for (const configFile of NUXT_CONFIG_FILES) {
    if (await fileExists(join(directory, configFile))) {
      return directory;
    }
  }
  return undefined;
};

export class ProjectAreas {
  private readonly buildModules: NearestDeclarations<BuildModule>;
  private readonly nuxtAppRoots: NearestDeclarations<string>;

  constructor(highestDirectory: string) {
    this.buildModules = new NearestDeclarations(highestDirectory, buildModuleDeclaredIn);
    this.nuxtAppRoots = new NearestDeclarations(highestDirectory, nuxtAppRootDeclaredIn);
  }

  public async contain(area: ProjectArea, file: string): Promise<boolean> {
    switch (area) {
      case "android-module":
        return (await this.buildModuleOf(file)) === "android";
      case "jvm-module":
        return (await this.buildModuleOf(file)) === "jvm";
      case "nuxt-app":
        return !(await this.isInNuxtServerDirectory(file));
      case "nuxt-server":
        return this.isInNuxtServerDirectory(file);
    }
  }

  private async buildModuleOf(file: string): Promise<BuildModule> {
    return (await this.buildModules.declarationAbove(file)) ?? "jvm";
  }

  private async isInNuxtServerDirectory(file: string): Promise<boolean> {
    const appRoot = await this.nuxtAppRoots.declarationAbove(file);
    return appRoot !== undefined && relative(appRoot, file).split(sep)[0] === NUXT_SERVER_DIRECTORY;
  }
}
