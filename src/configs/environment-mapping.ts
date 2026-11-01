import type { EnvironmentMapping } from "../admin-api/config-copy.js";
import { CliError } from "../CliError.js";
import { sameSlug } from "../same-slug.js";

const MAPPING_SEPARATOR = "=";

type MappedSlugs = [destinationSlug: string, sourceSlug: string];

const mappedSlugsOf = (mapping: string): MappedSlugs => {
  const separatorIndex = mapping.indexOf(MAPPING_SEPARATOR);
  const destinationSlug = mapping.slice(0, separatorIndex);
  const sourceSlug = mapping.slice(separatorIndex + MAPPING_SEPARATOR.length);
  if (separatorIndex === -1 || destinationSlug === "" || sourceSlug === "") {
    throw new CliError(`--environment takes <destination slug>=<source slug>, not ${mapping}.`);
  }
  return [destinationSlug, sourceSlug];
};

export const environmentMappingOf = (mappings: string[] | undefined): EnvironmentMapping => {
  const mappedSlugs = (mappings ?? []).map(mappedSlugsOf);
  const repeatedDestinationSlug = mappedSlugs.find(([destinationSlug], index) =>
    mappedSlugs
      .slice(0, index)
      .some(([earlierDestinationSlug]) => sameSlug(earlierDestinationSlug, destinationSlug)),
  )?.[0];
  if (repeatedDestinationSlug !== undefined) {
    throw new CliError(
      `--environment maps the destination environment "${repeatedDestinationSlug}" more than once. ` +
        "Case doesn't matter in slugs.",
    );
  }
  return Object.fromEntries(mappedSlugs);
};
