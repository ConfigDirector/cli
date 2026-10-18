import * as v from "valibot";

export type RepositoryScanUpload = {
  remoteUrl: string;
  commit: string;
  filesScanned: number;
  references: object[];
  dynamicReferences: object[];
};

const scannedRepositoryFields = {
  name: v.string(),
  commit: v.pipe(
    v.string(),
    v.transform((commit: string) => (commit === "" ? null : commit)),
  ),
  referenceCount: v.number(),
  dynamicReferenceCount: v.number(),
};

export const ScannedRepositorySchema = v.object(scannedRepositoryFields);

export type ScannedRepository = v.InferOutput<typeof ScannedRepositorySchema>;

export const ListedScannedRepositorySchema = v.object({
  ...scannedRepositoryFields,
  scannedAt: v.pipe(v.string(), v.isoTimestamp()),
});

export type ListedScannedRepository = v.InferOutput<typeof ListedScannedRepositorySchema>;
