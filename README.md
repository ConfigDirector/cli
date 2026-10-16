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

`scan` lists every place where the code reads a config key through a ConfigDirector SDK or OpenFeature provider, grouped by key, with the file and line of each. Test client calls, such as `setValue` or Java's `@BooleanConfigValue`, are included and marked as tests. Calls whose key is a variable or is built at runtime are listed under their own heading as dynamic references: the scan cannot tell which config they read. `configdirector scan src` scans only `src`.

A call is found when its file imports the SDK, or imports a file of the repository that does, such as the setup module the SDK docs create. A `getValue` from another library is not reported unless its file imports one of those. Imports are followed one level deep: relative imports in JavaScript and TypeScript, Python modules, Dart files including your own `package:` imports, and Go packages of the same module. A file that reaches the client through a second import, such as an `index` file that re-exports it, or through another file of the same Swift module or Go package without importing it, is not scanned. Nuxt's auto-imported composables need no import. A Kotlin or Java file belongs to the Android SDK when the nearest Gradle build file above it is an Android module, and to the Java server SDK otherwise. A Nuxt file belongs to the Nuxt server SDK when it is in the `server` directory next to the nearest `nuxt.config`, and to the Nuxt client SDK otherwise; a Next.js file belongs to the client or the server SDK by the entry point it imports.

The scan skips what `.gitignore` ignores, the `node_modules`, `vendor`, `build`, `dist` and `target` directories, binary files and files over 1 MB. In `configdirector.json`, `include` limits the scan to the files matching its globs, and `exclude` skips the files matching its globs.

With `--json`, `scan` prints the references for scripts and CI; `schema/scan-output.schema.json` in the package describes that output.

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
