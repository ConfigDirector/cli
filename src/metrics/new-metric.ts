import type { CreateMetricRequest } from "../admin-api/metrics.js";

export type CreateMetricOptions = {
  eventName: string;
  kind: string[];
  direction: string;
  description?: string;
};

export const newMetricOf = (options: CreateMetricOptions): CreateMetricRequest => ({
  eventName: options.eventName,
  kinds: options.kind,
  direction: options.direction,
  ...(options.description === undefined ? {} : { description: options.description }),
});
