import type { CreateMetricRequest } from "../admin-api/metrics.js";
import type { Invocation } from "../Invocation.js";
import { readFilterFile } from "./filter-file.js";

export type CreateMetricOptions = {
  eventName: string;
  filter?: string;
  valueField?: string;
  kind: string[];
  direction: string;
  description?: string;
};

export const newMetricOf = async (
  options: CreateMetricOptions,
  invocation: Invocation,
): Promise<CreateMetricRequest> => ({
  eventName: options.eventName,
  ...(options.filter === undefined ? {} : { filter: await readFilterFile(options.filter, invocation) }),
  ...(options.valueField === undefined ? {} : { valueField: options.valueField }),
  kinds: options.kind,
  direction: options.direction,
  ...(options.description === undefined ? {} : { description: options.description }),
});
