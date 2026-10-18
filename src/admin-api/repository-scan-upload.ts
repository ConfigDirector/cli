import * as v from "valibot";

export type RepositoryScanUpload = {
  remoteUrl: string;
  commit: string;
  filesScanned: number;
  references: object[];
  dynamicReferences: object[];
};

export const ScannedRepositorySchema = v.object({
  name: v.string(),
  commit: v.string(),
  referenceCount: v.number(),
  dynamicReferenceCount: v.number(),
});

export type ScannedRepository = v.InferOutput<typeof ScannedRepositorySchema>;
