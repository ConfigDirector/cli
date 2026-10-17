import { webApp } from "./scan-admin-api.js";
import { startStubAdminApi } from "./stub-admin-api.js";

const environmentFields = {
  projectId: webApp.id,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

export const testEnvironment = {
  ...environmentFields,
  id: "0b5f3c1a-6d2e-4f7a-9c8b-1a2b3c4d5e6f",
  slug: "test",
  name: "Test",
  color: "green",
  live: false,
};

export const productionEnvironment = {
  ...environmentFields,
  id: "7e6d5c4b-3a29-4810-8f7e-6d5c4b3a2918",
  slug: "production",
  name: "Production",
  color: "red",
  live: true,
};

const targetEnvironment = {
  id: productionEnvironment.id,
  name: productionEnvironment.name,
  slug: productionEnvironment.slug,
  color: productionEnvironment.color,
  live: productionEnvironment.live,
};

export const targetingRulesOf = (rules: object[]) => ({
  id: "d1b2c3d4-0000-4000-8000-000000000001",
  environment: targetEnvironment,
  rules,
  defaultValue: "false",
});

export const evaluationOf = (overrides: object = {}) => ({
  key: "new-checkout",
  environment: { id: productionEnvironment.id, slug: "production", name: "Production" },
  context: { kind: "user", identifier: "123", name: null, traits: { plan: "pro" } },
  value: "true",
  servedBy: { kind: "rule", ruleId: "a1b2c3d4-0000-4000-8000-000000000002" },
  rules: [
    {
      ruleId: "a1b2c3d4-0000-4000-8000-000000000001",
      outcome: "not-matched",
      conditions: [],
      bucket: {
        identifier: "123",
        defaultedToPredefinedBucket: false,
        assignedPercentage: 71.3,
        shares: [{ percentageId: "b1b2c3d4-0000-4000-8000-000000000001", from: 0, to: 50, value: "true" }],
      },
    },
    {
      ruleId: "a1b2c3d4-0000-4000-8000-000000000002",
      outcome: "matched",
      conditions: [
        {
          conditionId: "c1b2c3d4-0000-4000-8000-000000000001",
          kind: "attribute",
          outcome: "matched",
          resolvedValue: "pro",
          resolvedType: "scalar",
        },
      ],
    },
    { ruleId: "a1b2c3d4-0000-4000-8000-000000000003", outcome: "not-evaluated", conditions: [] },
  ],
  targetingRules: targetingRulesOf([
    {
      id: "a1b2c3d4-0000-4000-8000-000000000001",
      type: "percentage",
      target: "percentage",
      order: 0,
      percentages: [{ id: "b1b2c3d4-0000-4000-8000-000000000001", percentage: 50, value: true }],
    },
    {
      id: "a1b2c3d4-0000-4000-8000-000000000002",
      type: "conditional",
      order: 1,
      conditions: [
        {
          id: "c1b2c3d4-0000-4000-8000-000000000001",
          kind: "attribute",
          attribute: "traits",
          trait: "/plan",
          operator: "is one of",
          targetType: "text",
          targetValues: ["pro"],
        },
      ],
      target: "value",
      value: true,
      percentages: [],
    },
    {
      id: "a1b2c3d4-0000-4000-8000-000000000003",
      type: "percentage",
      target: "percentage",
      order: 2,
      percentages: [{ id: "b1b2c3d4-0000-4000-8000-000000000003", percentage: 100, value: false }],
    },
  ]),
  segments: {},
  ...overrides,
});

const evaluatePath = (key: string) => `/v1/projects/${webApp.id}/configs/${key}/evaluate`;

type EvaluateAdminApiOptions = {
  key?: string;
  environments?: object[];
  evaluateReply?: { status: number; body?: unknown };
};

export const startEvaluateAdminApi = ({
  key = "new-checkout",
  environments = [testEnvironment, productionEnvironment],
  evaluateReply = { status: 200, body: evaluationOf() },
}: EvaluateAdminApiOptions = {}) =>
  startStubAdminApi(
    { status: 404, body: {} },
    {
      "/v1/projects": { status: 200, body: [webApp] },
      [`/v1/projects/${webApp.id}/environments`]: { status: 200, body: environments },
      [evaluatePath(key)]: evaluateReply,
    },
  );
