import type { ConfigWithTargetingRules } from "../admin-api/config-with-targeting-rules.js";
import type { Variation } from "../admin-api/variations.js";
import { alignedColumns } from "../aligned-columns.js";
import { CliError } from "../CliError.js";
import { describeVariation } from "../rule-sentences.js";

const variationListing = (variations: Variation[]): string[] =>
  alignedColumns(variations.map((variation) => [describeVariation(variation), variation.id])).map(
    (line) => `  ${line}`,
  );

export const findVariationToShip = (config: ConfigWithTargetingRules, nameOrId: string): Variation => {
  if (config.variations.length === 0) {
    throw new CliError(`${config.key} has no variations to ship. Only an experiment has variations.`);
  }
  const matches = config.variations.filter(
    (variation) => variation.id === nameOrId || variation.name === nameOrId,
  );
  const [onlyMatch, ...otherMatches] = matches;
  if (onlyMatch === undefined) {
    throw new CliError(
      [
        `${config.key} has no variation named or with the id "${nameOrId}". Its variations are:`,
        ...variationListing(config.variations),
      ].join("\n"),
    );
  }
  if (otherMatches.length > 0) {
    throw new CliError(
      [
        `Several variations of ${config.key} are named "${nameOrId}". Give the id of the one to ship:`,
        ...variationListing(matches),
      ].join("\n"),
    );
  }
  return onlyMatch;
};
