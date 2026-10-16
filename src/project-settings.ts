import { join } from "node:path";
import * as v from "valibot";
import { CliError } from "./CliError.js";
import { parseJson, readFileIfPresent } from "./file-contents.js";

const ProjectSettingsSchema = v.object({
  project: v.optional(v.string()),
  include: v.optional(v.array(v.string())),
  exclude: v.optional(v.array(v.string())),
});

export type ProjectSettings = v.InferOutput<typeof ProjectSettingsSchema>;

export const projectSettingsFile = (workingDirectory: string): string =>
  join(workingDirectory, "configdirector.json");

const describeIssue = (issue: v.BaseIssue<unknown>): string => {
  const path = v.getDotPath(issue);
  return path === null ? issue.message : `${path}: ${issue.message}`;
};

export const readProjectSettings = async (workingDirectory: string): Promise<ProjectSettings | undefined> => {
  const file = projectSettingsFile(workingDirectory);
  const contents = await readFileIfPresent(file);
  if (contents === undefined) {
    return undefined;
  }
  const settings = v.safeParse(ProjectSettingsSchema, parseJson(contents));
  if (!settings.success) {
    throw new CliError(`${file} is not valid (${settings.issues.map(describeIssue).join("; ")}).`);
  }
  return settings.output;
};
