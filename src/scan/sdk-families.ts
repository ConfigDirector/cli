import type { ProjectArea } from "./project-areas.js";
import type { SourceExtension } from "./source-languages.js";

export type SdkFamily =
  | "js-client"
  | "js-server"
  | "react"
  | "react-native"
  | "vue"
  | "nuxt-client"
  | "nuxt-server"
  | "nextjs-client"
  | "nextjs-server"
  | "openfeature-web"
  | "openfeature-node"
  | "flutter"
  | "openfeature-flutter"
  | "swift"
  | "openfeature-swift"
  | "android"
  | "openfeature-android"
  | "java"
  | "openfeature-java"
  | "python"
  | "openfeature-python"
  | "dotnet"
  | "openfeature-dotnet"
  | "go"
  | "openfeature-go";

export const sdkTypes = ["client", "server"] as const;

export type SdkType = (typeof sdkTypes)[number];

export type GetterType = "boolean" | "string" | "integer" | "float" | "number" | "json";

export type ArgumentSlot = { position?: number; label?: string };

type CallForm = "method" | "function" | "annotation";

export type KeyArgument =
  { kind: "key"; slot: ArgumentSlot } | { kind: "mapKeys"; slot: ArgumentSlot; property?: string };

type ArgumentCount = { minimum: number; maximum?: number };

export type CallShape = {
  name: string;
  form: CallForm;
  argumentCount?: ArgumentCount;
  keyArgument: KeyArgument;
  inCodeDefault?: ArgumentSlot;
  getterType?: GetterType;
  test: boolean;
};

type SdkFamilyRecord = {
  sdkType: SdkType;
  extensions: readonly SourceExtension[];
  importMarkers: readonly string[];
  providerPackagesContainingMarkers?: readonly string[];
  projectArea?: ProjectArea;
  calls: readonly CallShape[];
};

const javascriptExtensions = [
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
] as const satisfies SourceExtension[];

const browserExtensions = [...javascriptExtensions, ".vue", ".svelte"] as const satisfies SourceExtension[];

const vueExtensions = [...javascriptExtensions, ".vue"] as const satisfies SourceExtension[];

type ReadOptions = {
  key?: ArgumentSlot;
  inCodeDefault?: ArgumentSlot;
  getterType?: GetterType;
  argumentCount?: ArgumentCount;
};

const read = (name: string, options: ReadOptions = {}): CallShape => ({
  name,
  form: "method",
  argumentCount: options.argumentCount,
  keyArgument: { kind: "key", slot: options.key ?? { position: 0 } },
  inCodeDefault: options.inCodeDefault ?? { position: 1 },
  getterType: options.getterType,
  test: false,
});

const readFunction = (name: string, options: Omit<ReadOptions, "getterType"> = {}): CallShape => ({
  ...read(name, options),
  form: "function",
});

const typedReads = (
  namesByGetterType: Partial<Record<GetterType, readonly string[]>>,
  options: Omit<ReadOptions, "getterType"> = {},
): CallShape[] =>
  Object.entries(namesByGetterType).flatMap(([getterType, names]) =>
    names.map((name) => read(name, { ...options, getterType: getterType as GetterType })),
  );

const keyOnly = (name: string, key: ArgumentSlot = { position: 0 }): CallShape => ({
  name,
  form: "method",
  keyArgument: { kind: "key", slot: key },
  test: false,
});

const testMethod = (name: string, key: ArgumentSlot = { position: 0 }): CallShape => ({
  ...keyOnly(name, key),
  test: true,
});

const testMap = (
  name: string,
  form: "method" | "function",
  slot: ArgumentSlot = { position: 0 },
  property?: string,
): CallShape => ({ name, form, keyArgument: { kind: "mapKeys", slot, property }, test: true });

const testAnnotation = (name: string): CallShape => ({
  name,
  form: "annotation",
  keyArgument: { kind: "key", slot: { label: "key" } },
  test: true,
});

const javascriptClientCalls = [read("getValue"), read("watch"), keyOnly("unwatch")];

const javascriptTestClientCalls = [
  testMap("createTestClient", "function", { position: 0 }, "values"),
  testMethod("setValue"),
  testMethod("removeValue"),
  testMap("replaceValues", "method"),
];

const openFeatureJavascriptGetters = typedReads({
  boolean: ["getBooleanValue", "getBooleanDetails"],
  string: ["getStringValue", "getStringDetails"],
  number: ["getNumberValue", "getNumberDetails"],
  json: ["getObjectValue", "getObjectDetails"],
});

const pythonLabels = {
  key: { position: 0, label: "config_key" },
  inCodeDefault: { position: 1, label: "default" },
};

const openFeaturePythonLabels = {
  key: { position: 0, label: "flag_key" },
  inCodeDefault: { position: 1, label: "default_value" },
};

const csharpLabels = {
  key: { position: 0, label: "configKey" },
  inCodeDefault: { position: 1, label: "defaultValue" },
};

const openFeatureCsharpLabels = {
  key: { position: 0, label: "flagKey" },
  inCodeDefault: { position: 1, label: "defaultValue" },
};

const openFeatureGoArguments = {
  key: { position: 1 },
  inCodeDefault: { position: 2 },
  argumentCount: { minimum: 4 },
};

const kotlinLabels = {
  key: { position: 0, label: "key" },
  inCodeDefault: { position: 1, label: "defaultValue" },
};

const swiftLabels = { key: { label: "for" }, inCodeDefault: { label: "default" } };

const openFeatureSwiftLabels = { key: { label: "key" }, inCodeDefault: { label: "defaultValue" } };

export const sdkFamilies: { [F in SdkFamily]: SdkFamilyRecord } = {
  "js-client": {
    sdkType: "client",
    extensions: browserExtensions,
    importMarkers: ["@configdirector/client-sdk"],
    calls: [...javascriptClientCalls, ...javascriptTestClientCalls],
  },
  "js-server": {
    sdkType: "server",
    extensions: javascriptExtensions,
    importMarkers: ["@configdirector/server-sdk"],
    calls: [...javascriptClientCalls, ...javascriptTestClientCalls],
  },
  react: {
    sdkType: "client",
    extensions: javascriptExtensions,
    importMarkers: ["@configdirector/react-web-sdk"],
    calls: [readFunction("useConfigValue"), ...javascriptClientCalls, ...javascriptTestClientCalls],
  },
  "react-native": {
    sdkType: "client",
    extensions: javascriptExtensions,
    importMarkers: ["@configdirector/react-native-sdk"],
    calls: [readFunction("useConfigValue"), ...javascriptClientCalls, ...javascriptTestClientCalls],
  },
  vue: {
    sdkType: "client",
    extensions: vueExtensions,
    importMarkers: ["@configdirector/vue-sdk"],
    calls: [readFunction("useConfigValue"), ...javascriptClientCalls, ...javascriptTestClientCalls],
  },
  "nuxt-client": {
    sdkType: "client",
    extensions: vueExtensions,
    importMarkers: ["useConfigDirectorValue", "useConfigDirectorClient", "@configdirector/nuxt-sdk"],
    projectArea: "nuxt-app",
    calls: [readFunction("useConfigDirectorValue"), ...javascriptClientCalls, ...javascriptTestClientCalls],
  },
  "nuxt-server": {
    sdkType: "server",
    extensions: javascriptExtensions,
    importMarkers: ["useConfigDirectorClient"],
    projectArea: "nuxt-server",
    calls: javascriptClientCalls,
  },
  "nextjs-client": {
    sdkType: "client",
    extensions: javascriptExtensions,
    importMarkers: ["@configdirector/nextjs-sdk/client"],
    calls: [readFunction("useConfigValue"), ...javascriptClientCalls, ...javascriptTestClientCalls],
  },
  "nextjs-server": {
    sdkType: "server",
    extensions: javascriptExtensions,
    importMarkers: ["@configdirector/nextjs-sdk/server"],
    calls: [...javascriptClientCalls, ...javascriptTestClientCalls],
  },
  "openfeature-web": {
    sdkType: "client",
    extensions: browserExtensions,
    importMarkers: ["@openfeature/web-sdk"],
    calls: openFeatureJavascriptGetters,
  },
  "openfeature-node": {
    sdkType: "server",
    extensions: javascriptExtensions,
    importMarkers: ["@openfeature/server-sdk"],
    calls: openFeatureJavascriptGetters,
  },
  flutter: {
    sdkType: "client",
    extensions: [".dart"],
    importMarkers: ["package:configdirector_flutter_client_sdk/"],
    calls: [
      read("getValue"),
      read("evaluate"),
      read("watch"),
      keyOnly("unwatch"),
      testMap("createTestClient", "function", { label: "values" }),
      testMethod("setValue"),
      testMethod("removeValue"),
      testMap("replaceValues", "method"),
    ],
  },
  "openfeature-flutter": {
    sdkType: "client",
    extensions: [".dart"],
    importMarkers: ["package:openfeature_dart_client_sdk/"],
    calls: typedReads({
      boolean: ["getBooleanValue", "getBooleanDetails"],
      string: ["getStringValue", "getStringDetails"],
      integer: ["getIntegerValue", "getIntegerDetails"],
      float: ["getDoubleValue", "getDoubleDetails"],
      json: ["getStructureValue", "getStructureDetails"],
    }),
  },
  swift: {
    sdkType: "client",
    extensions: [".swift"],
    importMarkers: ["import ConfigDirector"],
    providerPackagesContainingMarkers: ["ConfigDirectorOpenFeatureProvider"],
    calls: [
      read("value", swiftLabels),
      read("values", swiftLabels),
      testMap("makeTestClient", "function", { label: "values" }),
      testMethod("setValue", { label: "for" }),
      testMethod("removeValue", { label: "for" }),
      testMap("replaceValues", "method"),
    ],
  },
  "openfeature-swift": {
    sdkType: "client",
    extensions: [".swift"],
    importMarkers: ["import OpenFeature"],
    calls: [
      ...typedReads(
        {
          boolean: ["getBooleanValue", "getBooleanDetails"],
          string: ["getStringValue", "getStringDetails"],
          integer: ["getIntegerValue", "getIntegerDetails"],
          float: ["getDoubleValue", "getDoubleDetails"],
          json: ["getObjectValue", "getObjectDetails"],
        },
        openFeatureSwiftLabels,
      ),
      read("getValue", openFeatureSwiftLabels),
      read("getDetails", openFeatureSwiftLabels),
    ],
  },
  android: {
    sdkType: "client",
    extensions: [".kt", ".java"],
    importMarkers: ["com.configdirector"],
    providerPackagesContainingMarkers: ["com.configdirector.openfeature"],
    projectArea: "android-module",
    calls: [
      read("value", kotlinLabels),
      read("values", kotlinLabels),
      read("evaluate", kotlinLabels),
      ...typedReads(
        {
          boolean: ["getBoolean", "evaluateBoolean", "watchBoolean"],
          string: ["getString", "evaluateString", "watchString"],
          integer: ["getInt", "evaluateInt", "watchInt"],
          float: ["getDouble", "evaluateDouble", "watchDouble"],
          json: [
            "getJsonObject",
            "getJsonArray",
            "evaluateJsonObject",
            "evaluateJsonArray",
            "watchJsonObject",
            "watchJsonArray",
          ],
        },
        kotlinLabels,
      ),
      readFunction("configValue", kotlinLabels),
      testMap("createTestClient", "function", { position: 0, label: "values" }),
      testMethod("setValue", { position: 0, label: "key" }),
      testMethod("removeValue", { position: 0, label: "key" }),
      testMap("replaceValues", "method"),
    ],
  },
  "openfeature-android": {
    sdkType: "client",
    extensions: [".kt", ".java"],
    importMarkers: ["dev.openfeature.kotlin.sdk"],
    calls: typedReads(
      {
        boolean: ["getBooleanValue", "getBooleanDetails"],
        string: ["getStringValue", "getStringDetails"],
        integer: ["getIntegerValue", "getIntegerDetails"],
        float: ["getDoubleValue", "getDoubleDetails"],
        json: ["getObjectValue", "getObjectDetails"],
      },
      kotlinLabels,
    ),
  },
  java: {
    sdkType: "server",
    extensions: [".java", ".kt"],
    importMarkers: ["com.configdirector"],
    providerPackagesContainingMarkers: ["com.configdirector.openfeature"],
    projectArea: "jvm-module",
    calls: [
      ...typedReads({
        boolean: ["getBoolean", "watchBoolean"],
        string: ["getString", "watchString"],
        integer: ["getInteger", "watchInteger"],
        float: ["getDouble", "watchDouble"],
        json: ["getJsonObject", "getJsonArray", "watchJsonObject", "watchJsonArray"],
      }),
      read("getValue"),
      read("watch"),
      keyOnly("unwatch"),
      testMap("createTestClient", "function"),
      testMethod("setValue"),
      testMethod("setJsonValue"),
      testMethod("removeValue"),
      testMap("replaceValues", "method"),
      testAnnotation("BooleanConfigValue"),
      testAnnotation("StringConfigValue"),
      testAnnotation("IntegerConfigValue"),
      testAnnotation("FloatConfigValue"),
      testAnnotation("JsonConfigValue"),
    ],
  },
  "openfeature-java": {
    sdkType: "server",
    extensions: [".java", ".kt"],
    importMarkers: ["dev.openfeature.sdk"],
    calls: typedReads({
      boolean: ["getBooleanValue", "getBooleanDetails"],
      string: ["getStringValue", "getStringDetails"],
      integer: ["getIntegerValue", "getIntegerDetails", "getLongValue", "getLongDetails"],
      float: ["getDoubleValue", "getDoubleDetails"],
      json: ["getObjectValue", "getObjectDetails"],
    }),
  },
  python: {
    sdkType: "server",
    extensions: [".py"],
    importMarkers: ["import configdirector", "from configdirector"],
    providerPackagesContainingMarkers: ["configdirector_openfeature"],
    calls: [
      read("get_value", pythonLabels),
      read("watch", pythonLabels),
      keyOnly("unwatch", pythonLabels.key),
      testMap("create_test_client", "function", { position: 0, label: "values" }),
      testMethod("set_value", { position: 0, label: "key" }),
      testMethod("remove_value", { position: 0, label: "key" }),
      testMap("replace_values", "method", { position: 0, label: "values" }),
    ],
  },
  "openfeature-python": {
    sdkType: "server",
    extensions: [".py"],
    importMarkers: ["import openfeature", "from openfeature"],
    calls: typedReads(
      {
        boolean: [
          "get_boolean_value",
          "get_boolean_details",
          "get_boolean_value_async",
          "get_boolean_details_async",
        ],
        string: [
          "get_string_value",
          "get_string_details",
          "get_string_value_async",
          "get_string_details_async",
        ],
        integer: [
          "get_integer_value",
          "get_integer_details",
          "get_integer_value_async",
          "get_integer_details_async",
        ],
        float: ["get_float_value", "get_float_details", "get_float_value_async", "get_float_details_async"],
        json: [
          "get_object_value",
          "get_object_details",
          "get_object_value_async",
          "get_object_details_async",
        ],
      },
      openFeaturePythonLabels,
    ),
  },
  dotnet: {
    sdkType: "server",
    extensions: [".cs"],
    importMarkers: ["using ConfigDirector", "ConfigDirectorClient", "ConfigDirectorTesting"],
    providerPackagesContainingMarkers: ["ConfigDirector.OpenFeature"],
    calls: [
      read("GetValue", csharpLabels),
      read("Watch", csharpLabels),
      ...typedReads({ json: ["GetJsonValue", "WatchJson"] }, csharpLabels),
      keyOnly("Unwatch", csharpLabels.key),
      testMap("CreateTestClient", "function", { position: 0, label: "values" }),
      testMethod("SetValue", { position: 0, label: "key" }),
      testMethod("RemoveValue", { position: 0, label: "key" }),
      testMap("ReplaceValues", "method", { position: 0, label: "values" }),
    ],
  },
  "openfeature-dotnet": {
    sdkType: "server",
    extensions: [".cs"],
    importMarkers: ["using OpenFeature", "FeatureClient"],
    calls: typedReads(
      {
        boolean: ["GetBooleanValueAsync", "GetBooleanDetailsAsync"],
        string: ["GetStringValueAsync", "GetStringDetailsAsync"],
        integer: ["GetIntegerValueAsync", "GetIntegerDetailsAsync"],
        float: ["GetDoubleValueAsync", "GetDoubleDetailsAsync"],
        json: ["GetObjectValueAsync", "GetObjectDetailsAsync"],
      },
      openFeatureCsharpLabels,
    ),
  },
  go: {
    sdkType: "server",
    extensions: [".go"],
    importMarkers: ["github.com/ConfigDirector/go-sdks/configdirector"],
    providerPackagesContainingMarkers: ["github.com/ConfigDirector/go-sdks/configdirector-openfeature"],
    calls: [
      ...typedReads(
        {
          boolean: ["BoolValue", "BoolValueDetails"],
          string: ["StringValue", "StringValueDetails"],
          integer: ["IntValue", "IntValueDetails"],
          float: ["FloatValue", "FloatValueDetails"],
          json: ["JSONValue", "JSONValueDetails"],
        },
        { argumentCount: { minimum: 3, maximum: 3 } },
      ),
      ...typedReads(
        {
          boolean: ["WatchBool"],
          string: ["WatchString"],
          integer: ["WatchInt"],
          float: ["WatchFloat"],
          json: ["WatchJSON"],
        },
        { argumentCount: { minimum: 4, maximum: 4 } },
      ),
      testMap("NewTestClient", "function"),
      testMethod("SetValue"),
      testMethod("RemoveValue"),
      testMap("ReplaceValues", "method"),
    ],
  },
  "openfeature-go": {
    sdkType: "server",
    extensions: [".go"],
    importMarkers: ["github.com/open-feature/go-sdk/openfeature"],
    calls: typedReads(
      {
        boolean: ["Boolean", "BooleanValue", "BooleanValueDetails"],
        string: ["String", "StringValue", "StringValueDetails"],
        integer: ["Int", "IntValue", "IntValueDetails"],
        float: ["Float", "FloatValue", "FloatValueDetails"],
        json: ["Object", "ObjectValue", "ObjectValueDetails"],
      },
      openFeatureGoArguments,
    ),
  },
};

export const allSdkFamilies = Object.keys(sdkFamilies) as SdkFamily[];
