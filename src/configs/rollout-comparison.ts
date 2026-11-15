export type RolloutComparison = "variations-compared" | "needs-more-exposures";

export const comparisonOf = (state: string): RolloutComparison =>
  state === "needs-more-exposures" ? "needs-more-exposures" : "variations-compared";
