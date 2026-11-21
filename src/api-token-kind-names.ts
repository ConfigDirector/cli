import type { ApiTokenKind } from "./admin-api/AdminApiClient.js";

type ApiTokenKindName = { article: "a" | "an"; name: string };

export const apiTokenKindNames: { [Kind in ApiTokenKind]: ApiTokenKindName } = {
  user: { article: "a", name: "user API token" },
  organization: { article: "an", name: "organization API token" },
};
