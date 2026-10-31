import * as v from "valibot";

export type ConfigValue = boolean | number | string;

export type CreateConfigRequest = {
  key: string;
  description?: string;
  role: string;
  lifetime?: string;
  type: string;
  typeOptions?: object;
  client: boolean;
  server: boolean;
  variations: { name: string; value: ConfigValue }[];
  tagIds: string[];
  defaultValue: ConfigValue;
};

export const CreatedConfigSchema = v.object({
  key: v.string(),
  type: v.string(),
  role: v.string(),
  lifetime: v.string(),
  client: v.boolean(),
  server: v.boolean(),
});

export type CreatedConfig = v.InferOutput<typeof CreatedConfigSchema>;
