# ConfigDirector CLI

`configdirector` is the command line tool for [ConfigDirector](https://www.configdirector.com), the managed configuration and feature flag service. It is in beta: commands and output may change before 1.0. This release signs in, links a repository to a project, and lists where the repository's code reads config keys.

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

A call is found when its file imports the SDK, or imports a file of the repository that does, such as the setup module the SDK docs create. A `getValue` from another library is not reported unless its file imports one of those. Imports are followed one level deep: relative imports in JavaScript and TypeScript, Python modules, Dart files including your own `package:` imports, and Go packages of the same module. A file that reaches the client through a second import, such as an `index` file that re-exports it, or through another file of the same Swift module or Go package without importing it, is not scanned. Nuxt's auto-imported composables need no import. A Kotlin or Java file belongs to the Android SDK when the nearest Gradle build file above it is an Android module, and to the Java server SDK otherwise. A Nuxt file belongs to the Nuxt server SDK when it is in the `server` directory next to the nearest `nuxt.config`, and to the Nuxt client SDK otherwise; a Next.js file belongs to the client or the server SDK by the entry point it imports.

The scan skips what `.gitignore` ignores, the `node_modules`, `vendor`, `build`, `dist` and `target` directories, binary files and files over 1 MB. In `configdirector.json`, `include` limits the scan to the files matching its globs, and `exclude` skips the files matching its globs.

With `--json`, `scan` prints the references for scripts and CI; `schema/scan-output.schema.json` in the package describes that output. Each reference has a `kind`, `direct` or `indirect`, and a direct reference resolved from a constant carries the constant as `argument`.

## Options

| Option             | Environment variable      | Meaning                                                                           |
| ------------------ | ------------------------- | --------------------------------------------------------------------------------- |
| `--token <token>`  | `CONFIGDIRECTOR_TOKEN`    | API token. Without either, the token saved by `login` is used.                    |
| `--base-url <url>` | `CONFIGDIRECTOR_BASE_URL` | API host. Defaults to `https://api.configdirector.com`.                           |
| `--project <slug>` | `CONFIGDIRECTOR_PROJECT`  | Project slug. Without either, `scan` uses the `project` in `configdirector.json`. |
| `--json`           |                           | Print JSON on stdout. Errors always go to stderr.                                 |

The command exits with 0 when it succeeds and 2 when it could not run: a usage mistake, a rejected token, a suspended service or an unreachable API.

## License

[MIT](LICENSE)
