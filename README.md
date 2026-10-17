# ConfigDirector CLI

`configdirector` is the command line tool for [ConfigDirector](https://www.configdirector.com), the managed configuration and feature flag service. It is in beta: commands and output may change before 1.0. This release signs in, links a repository to a project, lists where the repository's code reads config keys, and checks those keys against the project's configs.

The [CLI page of the ConfigDirector docs](https://docs.configdirector.com/integrations/cli) covers the API token, CI setup for GitHub Actions and GitLab, and what each problem `validate` reports means for your build.

## Install

```bash
npm install --global @configdirector/cli@beta
```

It needs Node.js 20 or later.

## Sign in

Create an API token in the ConfigDirector dashboard, then run:

```bash
configdirector login
```

The token is saved for later runs, where only you can read it. In CI, set `CONFIGDIRECTOR_TOKEN` instead.

## Link a repository to a project

From the repository root:

```bash
configdirector init --project <project-slug>
```

This writes `configdirector.json`. Commit it so every run and every CI job uses the same project.

## Find where the code reads configs

From the repository root:

```bash
configdirector scan
```

`scan` lists every place where the code reads a config key through a ConfigDirector SDK or OpenFeature provider, grouped by key, with the file and line of each. Test client calls, such as `setValue` or Java's `@BooleanConfigValue`, are included and marked as tests. `configdirector scan src` scans only `src`.

A call that passes a constant instead of a string is reported under the constant's key when one assignment of a string to that name is found anywhere in the scanned code: `const NEW_CHECKOUT = "new-checkout"`, Kotlin `val`, Swift `case newCheckout = "new-checkout"`, Go `NewCheckout = "new-checkout"`, Python `NEW_CHECKOUT = "new-checkout"`, C# `const string`, and properties such as `checkoutV2: "new-checkout"` in object literals, enums and maps. A dotted argument such as `FLAGS.checkoutV2` or `Flag.newCheckout.rawValue` is looked up by its last name. The output shows the constant after the call, as in `getValue(NEW_CHECKOUT)`. A name assigned two different strings, an alias of another constant, a key built at runtime or a key read from configuration cannot be resolved, so those calls are listed under their own heading as dynamic references: the scan cannot tell which config they read.

The scan also looks for the project's current and deprecated keys wherever they appear as a quoted string outside those calls, such as in a wrapper function, a key list or a test fixture, and reports each as an indirect reference under its key. An indirect reference in a test directory or a test-named file, such as `test/`, `checkout.test.ts`, `checkout_test.go`, `test_checkout.py` or `CheckoutTests.cs`, is marked as a test, whereas a direct reference is marked as a test only when the call is a test client call. The definition of a constant that an SDK call reads is not repeated as an indirect reference.

A call is found when its file imports the SDK, or imports a file of the repository that does, such as the setup module the SDK docs create. In Swift and Go, it is also found when another file of the same Swift target or Go package imports the SDK, since those files use each other's declarations without an import. A `getValue` from another library is not reported unless its file, or its Swift target or Go package, imports one of those. Imports are followed one level deep: relative imports and path aliases in JavaScript and TypeScript, Python modules, Dart files including your own `package:` imports, and Go packages of the same module. When the imported file does not import the SDK itself, the scan follows what it re-exports, up to two steps, so an `index` file or a barrel library in front of the setup module works: `export { client } from "./setup"` and `export * from "./setup"` in JavaScript and TypeScript, `export 'src/setup.dart';` in Dart, and relative imports such as `from .flags import client` in a Python package's `__init__.py`. A file that reaches the client through a second ordinary import, a re-export written as an import followed by a separate `export`, or a CommonJS `module.exports` is not scanned. A Go package is the `.go` files of one directory with the same `package` name, so an external test package such as `package shop_test` counts only through its own imports. A Swift target is found from the nearest `Package.swift` or Xcode project above the file: in a Swift package, each directory under `Sources/` or `Tests/` is a target; an Xcode project's directory is one target; with neither, the file's own directory is. Nuxt's auto-imported composables need no import. A Kotlin or Java file belongs to the Android SDK when the nearest Gradle build file above it is an Android module, and to the Java server SDK otherwise. A Nuxt file belongs to the Nuxt server SDK when it is in the `server` directory next to the nearest `nuxt.config`, and to the Nuxt client SDK otherwise; a Next.js file belongs to the client or the server SDK by the entry point it imports.

A path alias such as `@/lib/config-director` is resolved the way TypeScript resolves it, from `compilerOptions.paths` and `baseUrl` in the nearest `tsconfig.json` above the importing file, or `jsconfig.json` when that directory has no `tsconfig.json`. Configs it extends with a relative path count, and when it declares no aliases of its own, the configs listed in its `references` are tried in order, as in Vite's templates. Nuxt's `~` and `@` aliases work once `nuxt prepare`, a dev run or a build has generated the `.nuxt` configs. Aliases set only in bundler configuration, such as `resolve.alias` in `vite.config.ts` or webpack, are not followed. These configs and the files they point to, like the other files of a Swift target or Go package, are read even when the scan would skip them, as long as they are under 1 MB.

The scan skips what `.gitignore` ignores, the `node_modules`, `vendor`, `build`, `dist` and `target` directories, binary files and files over 1 MB. In `configdirector.json`, `include` limits the scan to the files matching its globs, and `exclude` skips the files matching its globs.

With `--json`, `scan` prints the references for scripts and CI; `schema/scan-output.schema.json` in the package describes that output. Each reference has a `kind`, `direct` or `indirect`, and a direct reference resolved from a constant carries the constant as `argument`.

## Check the keys the code reads

From the repository root, or as a CI step:

```bash
configdirector validate
```

`validate` runs the same scan, then checks every config key the code reads through an SDK against the project's configs. It exits with 1 when it finds a problem, so the build fails before a wrong key ships:

- **Unknown key**: no config in the project has the key, as its current key or a deprecated one, so the SDK always returns the in-code default value. The key of an archived config is unknown too.
- **Deprecated key**: the config was renamed. The output names its current key.
- **Type mismatch**: the in-code default value, or a getter whose name fixes the type such as `getBoolean`, reads the config as a type the SDKs do not serve it as, so the SDK returns the in-code default value. A boolean reads a boolean config; an integer reads an integer, float or timespan config; a float reads a float or timespan config; a string reads a string, enum or URL config; an object or array reads a JSON config. A timespan is served as a number in its unit, so read it with a number, not a string such as `"30s"`. An enum whose values are numbers can also be read with a number.
- **Availability mismatch**: a client SDK reads a server-only config, or a server SDK reads a client-only config, so the SDK never receives it.
- **Enum value not allowed**: the in-code default value is not one of the enum's allowed values.

A test client call, such as `setValue` or `createTestClient`, is checked for unknown and deprecated keys only, since ConfigDirector never serves a test client. Dynamic and indirect references are listed by `scan` but never checked, and a config's lifecycle state is never a problem. To skip a key, such as one another project serves, list it in `ignoreKeys` in `configdirector.json`. `include` and `exclude` narrow the files checked as they do for `scan`.

The output lists the problems grouped by kind, with the file, the line, the key and what is wrong, such as the type a timespan is served as, then counts the references checked. With `--json`, `validate` prints the scan's JSON with a `findings` array; `schema/scan-output.schema.json` describes it.

## Options

| Option             | Environment variable      | Meaning                                                                                         |
| ------------------ | ------------------------- | ----------------------------------------------------------------------------------------------- |
| `--token <token>`  | `CONFIGDIRECTOR_TOKEN`    | API token. Without either, the token saved by `login` is used.                                  |
| `--base-url <url>` | `CONFIGDIRECTOR_BASE_URL` | API host. Defaults to `https://api.configdirector.com`.                                         |
| `--project <slug>` | `CONFIGDIRECTOR_PROJECT`  | Project slug. Without either, `scan` and `validate` use the `project` in `configdirector.json`. |
| `--json`           |                           | Print JSON on stdout. Errors always go to stderr.                                               |

The command exits with 0 when it succeeds, 1 when `validate` found a problem, and 2 when it could not run: a usage mistake, a rejected token, a suspended service or an unreachable API. A CI job can therefore tell a wrong config key from an outage.

## License

[MIT](LICENSE)
