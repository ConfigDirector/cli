import type { UpdateMetricRequest } from "../admin-api/metrics.js";
import { CliError } from "../CliError.js";

export type UpdateMetricOptions = {
  kind?: string[];
  direction?: string;
  description?: string;
};

export const metricChangesOf = (options: UpdateMetricOptions): UpdateMetricRequest => {
  const changes: UpdateMetricRequest = {
    ...(options.kind === undefined ? {} : { kinds: options.kind }),
    ...(options.direction === undefined ? {} : { direction: options.direction }),
    ...(options.description === undefined ? {} : { description: options.description }),
  };
  if (Object.keys(changes).length === 0) {
    throw new CliError("Say what to change with --kind, --direction or --description.");
  }
  return changes;
};
