import type { MetricDefinition } from "../admin-api/metrics.js";
import type { KindWithAMetricOfItsOwn } from "./metric-words.js";

type DefinedMetric = { definition: MetricDefinition };

const KIND_REPORTED_ALONE: {
  [DefinedBy in MetricDefinition["definedBy"]]: KindWithAMetricOfItsOwn | undefined;
} = {
  "event-name": undefined,
  ratio: "ratio",
  funnel: "funnel",
  retention: "retention",
};

export const kindReportedAloneBy = ({ definition }: DefinedMetric): KindWithAMetricOfItsOwn | undefined =>
  KIND_REPORTED_ALONE[definition.definedBy];

export const eventNamesCountedBy = ({ definition }: DefinedMetric): string[] => {
  switch (definition.definedBy) {
    case "event-name":
      return [definition.eventName];
    case "ratio":
      return [definition.ratio.numerator.eventName, definition.ratio.denominator.eventName];
    case "funnel":
      return definition.funnel.steps.map((step) => step.eventName);
    case "retention":
      return [definition.retention.eventName];
  }
};
