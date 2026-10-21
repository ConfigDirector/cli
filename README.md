# ConfigDirector CLI

`configdirector` is the command line tool for [ConfigDirector](https://www.configdirector.com), the managed configuration and feature flag service. Commands and output may change before 1.0. This release signs in to one or more organizations, links a repository to a project, lists where the repository's code reads config keys, checks those keys against the project's configs, shows the value a context gets for a config and why, reads a project's environments, configs, targeting rules and segments, creates configs, replaces a config's targeting rules in an environment, archives configs, creates, updates and deletes segments, uploads the repository's code references to the project, and lists and removes the project's scanned repositories.

The [CLI page of the ConfigDirector docs](https://docs.configdirector.com/integrations/cli) covers the API token, CI setup for GitHub Actions and GitLab, and what each problem `validate` reports means for your build.

## Install

```bash
npm install --global @configdirector/cli
```

It needs Node.js 20 or later. If you installed `@configdirector/cli@beta` before 0.11.0, run this again: `@beta` stays on the last beta, 0.10.0-beta.1.

Or install it with Homebrew, which takes care of Node.js:

```bash
brew install ConfigDirector/tap/configdirector
```

The Homebrew formula is updated with every npm release, so `brew upgrade configdirector` gets the newest one.

## Sign in

Create an API token in the ConfigDirector dashboard, then run:

```bash
configdirector login
```

The token is saved as your sign-in for its organization, where only you can read it. You keep one sign-in per organization: run `login` again with a token of another organization to add one, and `configdirector logout` removes the sign-in the commands in the current directory would use. `configdirector api-token get` shows which token a command there would use, with its organization, name, permissions and expiration. In CI, set `CONFIGDIRECTOR_TOKEN` instead.

## Link a repository to a project

From the repository root:

```bash
configdirector init --project <project-slug>
```

This writes `configdirector.json` with the project's slug and the id of its organization. Commit it so every run and every CI job uses the same project. `init` looks for the project through each of your sign-ins, so with two organizations each repository links to its own, and a command in the repository uses that organization's sign-in. A token from another organization, such as a `CONFIGDIRECTOR_TOKEN` set for an MCP server, is refused there.

## Find where the code reads configs

From the repository root:

```bash
configdirector scan
```

`scan` lists every place where the code reads a config key through a ConfigDirector SDK or OpenFeature provider, grouped by key, with the file and line of each. Test client calls, such as `setValue` or Java's `@BooleanConfigValue`, are included and marked as tests. `configdirector scan src` scans only `src`.

A call that passes a constant instead of a string is reported under the constant's key when one assignment of a string to that name is found anywhere in the scanned code: `const NEW_CHECKOUT = "new-checkout"`, Kotlin `val`, Swift `case newCheckout = "new-checkout"`, Go `NewCheckout = "new-checkout"`, Python `NEW_CHECKOUT = "new-checkout"`, C# `const string`, and properties such as `checkoutV2: "new-checkout"` in object literals, enums and maps. A dotted argument such as `FLAGS.checkoutV2` or `Flag.newCheckout.rawValue` is looked up by its last name. The output shows the constant after the call, as in `getValue(NEW_CHECKOUT)`. A name assigned two different strings, an alias of another constant, a key built at runtime or a key read from configuration cannot be resolved, so those calls are listed under their own heading as dynamic references: the scan cannot tell which config they read.

The scan also looks for the project's current and deprecated keys wherever they appear as a quoted string outside those calls, such as in a wrapper function, a key list or a test fixture, and reports each as an indirect reference under its key. An indirect reference in a test directory or a test-named file, such as `test/`, `checkout.test.ts`, `checkout_test.go`, `test_checkout.py` or `CheckoutTests.cs`, is marked as a test, whereas a direct reference is marked as a test only when the call is a test client call. The definition of a constant that an SDK call reads is not repeated as an indirect reference.

A call is found when its file imports the SDK, or imports a file of the repository that does, such as the setup module the SDK docs create. In Swift and Go, it is also found when another file of the same Swift target or Go package imports the SDK, since those files use each other's declarations without an import. In Kotlin, Java and C#, it is also found when the file uses a class of your own whose file imports the SDK, such as an `object Flags` or a static class that holds the client. A `getValue` from another library is not reported unless its file, its Swift target or Go package, or a class of your own that it uses imports one of those, so Android's `SharedPreferences.getBoolean` and ASP.NET's `IConfiguration.GetValue` are not reported next to a class that holds the client. Imports are followed one level deep: relative imports and path aliases in JavaScript and TypeScript, Python modules, Dart files including your own `package:` imports, and Go packages of the same module. When the imported file does not import the SDK itself, the scan follows what it re-exports, up to two steps, so an `index` file or a barrel library in front of the setup module works: `export { client } from "./setup"` and `export * from "./setup"` in JavaScript and TypeScript, `export 'src/setup.dart';` in Dart, and relative imports such as `from .flags import client` in a Python package's `__init__.py`. A file that reaches the client through a second ordinary import, a re-export written as an import followed by a separate `export`, or a CommonJS `module.exports` is not scanned. A Go package is the `.go` files of one directory with the same `package` name, so an external test package such as `package shop_test` counts only through its own imports. A Swift target is found from the nearest `Package.swift` or Xcode project above the file: in a Swift package, each directory under `Sources/` or `Tests/` is a target; an Xcode project's directory is one target; with neither, the file's own directory is. A class of your own counts when its file is named after it, such as `Flags.kt`, `Flags.java` or `Flags.cs`, and only that class is read, not the classes it uses in turn. Kotlin and Java find it through the file's imports, including `import static` and wildcard imports, under the source directory its `package` points to, and among the files of its own directory, so a class of the same package in another source directory or module, such as a test in `src/test/java` using a class of `src/main/java`, is not followed. When the directory does not match the `package`, as when the directories leave out the common root package, the imports are not followed. C# finds it as a `.cs` file of that name anywhere in the project of the nearest `.csproj`, outside `bin`, `obj` and the directories the scan always skips, whatever brings the SDK's namespace in, a global using included. A Kotlin client declared at the top level of a file, outside any object or class, is not followed. Nuxt's auto-imported composables need no import. A Kotlin or Java file belongs to the Android SDK when the nearest Gradle build file above it is an Android module, and to the Java server SDK otherwise. A Nuxt file belongs to the Nuxt server SDK when it is in the `server` directory next to the nearest `nuxt.config`, and to the Nuxt client SDK otherwise; a Next.js file belongs to the client or the server SDK by the entry point it imports.

A path alias such as `@/lib/config-director` is resolved the way TypeScript resolves it, from `compilerOptions.paths` and `baseUrl` in the nearest `tsconfig.json` above the importing file, or `jsconfig.json` when that directory has no `tsconfig.json`. Configs it extends with a relative path count, and when it declares no aliases of its own, the configs listed in its `references` are tried in order, as in Vite's templates. Nuxt's `~` and `@` aliases work once `nuxt prepare`, a dev run or a build has generated the `.nuxt` configs. Aliases set only in bundler configuration, such as `resolve.alias` in `vite.config.ts` or webpack, are not followed. These configs and the files they point to, like the other files of a Swift target or Go package and the Kotlin, Java and C# classes a file uses, are read even when the scan would skip them, as long as they are under 1 MB; only C# classes in `bin`, `obj` and the directories the scan always skips are not looked for.

The scan skips what `.gitignore` ignores, the `node_modules`, `vendor`, `build`, `dist` and `target` directories, binary files and files over 1 MB. In `configdirector.json`, `include` limits the scan to the files matching its globs, and `exclude` skips the files matching its globs.

With `--json`, `scan` prints the references for scripts and CI; `schema/scan-output.schema.json` in the package describes that output. Each reference has a `kind`, `direct` or `indirect`, and a direct reference resolved from a constant carries the constant as `argument`.

Each direct and indirect reference in the JSON also carries a `snippet`: its line and the 2 lines before and after it, without line endings, with any line longer than 250 characters cut to its first 250. `--context-lines <number>` includes from 0 to 5 lines on each side, and `--no-snippets` leaves every snippet out; giving both exits with 2. Dynamic references have no snippet, and the text output shows none.

## Upload the scan to ConfigDirector

From the repository root, on the default branch:

```bash
configdirector scan --upload
```

`--upload` sends the scan to the project, so the dashboard can show where each config is read and which configs no repository reads. Each upload replaces all the references the project held for the repository. The CLI does not check which branch is checked out, so run it on pushes to the default branch, and keep `validate` for pull requests.

The repository is named after the path of its git remote `origin`, without the host and `.git`: `https://github.com/acme/shop.git`, `git@github.com:acme/shop.git` and `ssh://git@github.com/acme/shop.git` all upload to `acme/shop`, and a GitLab subgroup keeps its whole path, such as `group/subgroup/app`. The upload also sends the remote's URL, without the user name and password of an `https` remote, such as the job token GitLab CI puts there, and the commit checked out, both read by running `git`. `--repository <name>` names the repository yourself. Without it, `scan --upload` exits with 2 when `git` is not installed, when the directory is not in a git repository, or when that repository has no `origin` remote; with it, each of those cases uploads with no remote URL and no commit. A repository with no commit yet uploads with no commit.

The upload holds the references and dynamic references `scan --json` prints, whatever `ignoreKeys` lists, except a reference to a key that cannot be a config key, such as one shorter than 4 characters, which is left out and counted. The output is the scan's, then a line naming the repository, the commit, the project, how many references were sent and how many were left out. A scan that finds no source file exits with 2 and uploads nothing, so a wrong path or `include` never empties the repository's references; a scan that reads files and finds no reference uploads an empty set. With `--json`, it prints the Admin API's response as received.

Each direct and indirect reference is sent with its snippet, so the dashboard can show the code around it; `--no-snippets` sends no code, and `--context-lines` sets how many lines are sent. When the project's Code snippets setting is off, `scan --upload` sends no snippets and ends with `Code snippets were not sent: this project does not store them.`

A project holds at most 50 scanned repositories, and one upload holds at most 10,000 references, dynamic references included; going over either exits with 2. `scan --upload` needs `projects:read`, `configs:read` and `code-references:update`. Uploads do not appear in the audit log.

## List and remove scanned repositories

```bash
configdirector repositories list
```

`repositories list` lists the repositories whose scan was uploaded to the project, one per line, with the commit, when it was scanned in UTC, and how many references and dynamic references it holds, and ends with how many scanned repositories the project has out of the 50 it can hold:

```txt
ConfigDirector/cli   4d40f50   2026-10-17 10:00 UTC   12 references   1 dynamic reference
acme/storefront      9f3e2a1   2026-10-16 09:12 UTC   1 reference     0 dynamic references

web-app has 2 of the 50 scanned repositories a project can hold.
```

A repository uploaded without a commit shows `no commit`. With `--json`, it prints the Admin API's response as received, which also holds each repository's remote URL and how many files its scan read. `repositories list` needs `projects:read` and `code-references:read`.

```bash
configdirector repositories remove acme/storefront
```

Nothing removes a scanned repository on its own: a repository that is renamed or retired keeps its last upload, keeps counting toward the 50, and the dashboard keeps using its references to show where each config is read and which configs no repository reads. `repositories remove <name>` removes the repository and all its references from the project, with no confirmation, and prints `Removed acme/storefront and its code references from web-app.` To rename a repository, remove the old name and upload under the new one; a removed repository that uploads again is added back. When no scanned repository in the project has the name, it exits with 2 and lists the names the project has. With `--json`, it prints `{ "removedRepository": "acme/storefront" }`, with the name as given.

`repositories remove` needs `projects:read` and `code-references:update`, and `code-references:read` to list the names when none matches. Removals do not appear in the audit log.

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

## GitHub Action

The [ConfigDirector Code Scan](https://github.com/ConfigDirector/scan-code) action runs `validate` on pull requests, and `validate` then `scan --upload` on pushes to the default branch:

```yaml
- uses: ConfigDirector/scan-code@v1
  with:
    token: ${{ secrets.CONFIGDIRECTOR_TOKEN }}
```

Its README lists the inputs and the permissions the token needs for each step.

## See what a context gets for a config

```bash
configdirector evaluate new-checkout --environment production --context-id 123 --context-trait plan=pro
```

`evaluate` evaluates the environment's saved targeting rules for a context with the evaluator the SDKs use, so the value it shows is the one your application gets. It also shows the rule that served the value, and what each rule tests and what happened to it:

```txt
new-checkout in Production for user 123

true, served by rule 2

1. 50% get true                     not matched: bucket 71.3 is outside 0 to 50
2. plan is one of pro, team: true   matched
3. in segment Beta testers: true    not evaluated
Default targeting rule: false
```

A rule that did not match names the first condition that failed and the context's value for it, as in `plan is one of pro, team, but it is "free"`, or the bucket a percentage rollout put the context in. A rule after the one that served the value is not evaluated, and a rule that could not be evaluated is shown as errored.

`--environment` takes the environment's slug and is required. Give the context one of three ways:

- `--context-kind` (default `user`), `--context-id`, `--context-name`, and `--context-trait name=value` for each trait. A trait's value is a string; write `name:=` followed by JSON for a number, boolean, array or object, as in `--context-trait beta:=true` or `--context-trait age:=30`. For nested traits, use `--context-json`.
- `--context-json '{"identifier": "123", "traits": {"plan": "pro"}}'`, or `--context-json @context.json` to read it from a file. The object takes `kind`, `identifier`, `name` and `traits`.
- `--saved-context user:123`, the context kind and identifier of a context ConfigDirector saved from SDK evaluations in that environment. It is evaluated with its stored name and traits.

Without any of them, the config is evaluated for an empty context, as an SDK given none would. A renamed config can be evaluated by an old key; the output then starts with a line naming the current key. With `--json`, `evaluate` prints the Admin API's response as received.

`evaluate` needs a token with `environments:read` as well as `projects:read` and `configs:read`, and `contexts:read` for `--saved-context`. Nothing is recorded: an evaluation from the CLI is not SDK activity.

## Browse the project

```bash
configdirector projects list
configdirector environments list
configdirector configs list [--tag <name>] [--untagged] [--state <state>]
configdirector configs get <key>
configdirector configs activity <key>
configdirector segments list
configdirector segments get <key>
```

`projects list` lists your organization's projects with their slugs and names, whichever project is selected. The other commands read the project from `--project`, `CONFIGDIRECTOR_PROJECT` or `configdirector.json`, as `scan` does:

- `environments list` lists the environments with their slugs and names, marking the live ones.
- `configs list` lists the configs with their type, role, lifetime and lifecycle state. `--tag <name>`, repeatable, lists the configs that have any of the tags; `--untagged` lists the configs without tags and cannot be combined with `--tag`; `--state` lists the configs in one lifecycle state: `new`, `in-use`, `settled`, `archive-ready` or `stale`. A tag name no tag has exits with 2.
- `configs get <key>` shows the config's settings, including its type's constraints, then each environment's targeting rules in order, written as `evaluate` writes them, with the default targeting rule value last. An old key works, and the output then starts with a line naming the current key.
- `configs activity <key>` shows when SDKs last evaluated the config, one line per environment, SDK key kind, SDK name and SDK version, with the time in UTC.
- `segments list` lists the segments with how many configs use each, and `segments get <key>` shows a segment's condition groups and its environment overrides.

```txt
new-checkout
  Description: Shows the new checkout flow
  Type: boolean
  Role: flag
  Lifetime: temporary
  Availability: client and server SDKs
  Lifecycle state: in-use
  Tags: checkout

test
  Default targeting rule: false

production (live)
  1. plan is one of pro, team: true
  2. 30% get true, 70% get false
  3. in segment Beta testers: true
  Default targeting rule: false
```

With `--json`, each prints the Admin API's response as received, except `configs list --state`, which prints only the configs in that state. A key no config or segment has exits with 2.

`projects list` needs `projects:read`. The others need `projects:read` to find the project, and `environments list` needs `environments:read`, `configs list`, `configs get` and `configs activity` need `configs:read`, plus `tags:read` for `--tag`, and `segments list` and `segments get` need `segments:read`. Without `segments:read`, `configs get` shows a segment condition's segment ID instead of its name; without `environments:read`, `segments get` names an override's environment by its ID instead of its slug.

## Create a config

```bash
configdirector configs create --key new-checkout --type boolean --role flag --lifetime temporary --default-value false
```

`configs create` creates a config from options that match the Admin API's fields one to one, with no guessing and no prompts:

```txt
Created new-checkout in web-app: boolean, flag, temporary, client and server SDKs.
Default targeting rule in every environment: false
```

- `--key`, `--type` (`boolean`, `string`, `integer`, `float`, `timespan`, `enum`, `url` or `json`), `--role` (`config`, `flag`, `kill-switch` or `experiment`), `--lifetime` (`temporary` or `permanent`) and `--default-value` are required. `--default-value` is the default targeting rule value every environment starts with, not the in-code default value an application passes to the SDK.
- `--description <text>`; `--client-only` or `--server-only`, without which client and server SDKs both receive the config; `--tag <name>`, repeatable, naming an existing tag of the project; and `--variation <name=value>`, repeatable, for an experiment's variations.
- The values of `--default-value` and `--variation` are read in the config's type: `true` or `false`, a number for an integer, float or timespan, the text as written for a string, enum or URL, and JSON for a JSON config, with `@file` reading it from a file. A value that does not fit the type is a usage error.
- Constraints, each accepted only by its types: `--min` and `--max` (a value may equal them) for an integer, float or timespan; `--exclusive-min` and `--exclusive-max` for an integer or float; `--unit` (`milliseconds`, `seconds` or `minutes`) and `--allow-fractions` for a timespan, which needs `--unit`, `--min` and `--max`; `--allowed-value`, repeatable, and `--enum-value-type string|number` (default `string`) for an enum; `--https-only` for a URL, without which any HTTP or HTTPS URL is accepted; and `--json-schema <file>` for a JSON config. An option of another type is a usage error naming the types it belongs to. A timespan without `--unit`, `--min` or `--max` is a usage error too.

```bash
configdirector configs create --key checkout-timeout --type timespan --role config --lifetime permanent \
  --unit seconds --min 1 --max 120 --default-value 30 --server-only
```

When the project already has a config with the key, as its current key or an old one, nothing is created: the command prints that config's key, type, role, lifetime and lifecycle state, and exits with 1. When ConfigDirector refuses the config for another reason, it exits with 2 and lists the reasons. With `--json`, it prints the created config as received, or the existing config when the key is taken.

`configs create` needs `projects:read`, `configs:create`, and `configs:read` to show the config that already has the key; `--tag` also needs `tags:read` and `config-settings:update`. The config shows in the audit log with the source CLI.

## Change targeting rules

```bash
configdirector targeting-rules set new-checkout --environment production --rules rules.json
```

`targeting-rules set` replaces every targeting rule of the config in one environment with the rules in the file, or in stdin with `--rules -`:

```json
{
  "defaultValue": false,
  "rules": [
    {
      "type": "conditional",
      "order": 0,
      "conditions": [
        {
          "kind": "attribute",
          "attribute": "traits",
          "trait": "/plan",
          "operator": "is one of",
          "targetType": "text",
          "targetValues": ["pro", "team"]
        }
      ],
      "target": "value",
      "value": true
    }
  ]
}
```

- The file holds `defaultValue`, the default targeting rule value, and `rules`, exactly as the Admin API takes them. An environment's entry of `targets` in `configs get --json` has that shape, so you can edit it and write it back. Rules left out of the file are removed.
- A rule, condition or percentage without an `id` gets a new one, and the IDs given are kept.
- The CLI checks only that the file holds a JSON object. ConfigDirector checks the rules, and when it refuses them the command exits with 2 and lists its reasons.
- It asks for no confirmation and treats a live environment like any other. It prints what it wrote: `Replaced the targeting rules of new-checkout in production with 1 rule and the default targeting rule value false.` With `--json`, it prints the request it sent, with the IDs it gave.

`targeting-rules reference` prints the format: notes on how rules are evaluated, the condition kinds, the attributes a condition can test, and the operators for context kinds, segments and each target type. With `--json`, it prints the whole document as received, including the JSON Schema of the request `targeting-rules set` sends. Its notes name the MCP server's tools: `update_targeting_rules` is what `targeting-rules set` does, and `get_config` what `configs get` does.

`targeting-rules set` needs `projects:read`, `environments:read` and `config-targeting-rules:update`. `targeting-rules reference` needs only a valid token and no project.

## Change segments

```bash
configdirector segments create --segment beta-testers.json
configdirector segments update beta-testers --segment beta-testers.json
configdirector segments delete beta-testers
```

`segments create` creates a segment from the file, or from stdin with `--segment -`, and `segments update <key>` replaces the segment the key names with it:

```json
{
  "key": "beta-testers",
  "name": "Beta testers",
  "groups": [
    [
      {
        "kind": "attribute",
        "attribute": "traits",
        "trait": "/email",
        "operator": "ends with any of",
        "targetType": "text",
        "targetValues": ["@example.com"]
      }
    ]
  ],
  "overrides": {
    "7e6d5c4b-3a29-4810-8f7e-6d5c4b3a2918": [
      [
        {
          "kind": "attribute",
          "attribute": "traits",
          "trait": "/email",
          "operator": "ends with any of",
          "targetType": "text",
          "targetValues": ["@staff.example.com"]
        }
      ]
    ]
  }
}
```

- The file holds the segment's `key`, `name` and condition `groups`, exactly as the Admin API takes them. `overrides` is optional and gives an environment condition groups of its own, keyed by the environment's ID, which `environments list --json` prints. `segments get --json` prints a segment in this shape, so you can edit it and send it back; fields the Admin API does not take, such as `usages`, are ignored.
- A condition without an `id`, in the groups or in an override, gets a new one, and the IDs given are kept.
- `update` replaces the key, the name and the groups, so a different `key` renames the segment, and the segment keeps its own ID whatever `id` the file holds. Without `overrides` in the file, the environment overrides stay as they are; `"overrides": {}` removes them all, and a map leaves exactly those environments overridden.
- The CLI checks only that the file holds a JSON object. ConfigDirector checks the segment, and when it refuses it, for example because another segment has its key, the command exits with 2 and lists its reasons.
- It asks for no confirmation. It prints `Created segment beta-testers in web-app.` or `Updated segment beta-testers in web-app.`, then the segment as `segments get` shows it. With `--json`, it prints the segment as the Admin API returned it.

`segments delete <key>` deletes a segment and its environment overrides, with no confirmation, and prints `Deleted segment beta-testers from web-app.`; `--json` prints `{ "deletedSegmentKey": "beta-testers" }` with the key as given. While the targeting rules of a config use the segment, in any environment, it is not deleted: the command exits with 2 and lists each config with the environments whose rules use it, so you can remove those segment conditions with `targeting-rules set` first. A key no segment has exits with 2 for `update` and `delete`.

`segments create` needs `projects:read` and `segments:create`, `segments update` needs `projects:read`, `segments:read` and `segments:update`, and `segments delete` needs `projects:read` and `segments:delete`. Without `environments:read`, they name environments by ID instead of by slug. The change shows in the audit log with the source CLI.

## Archive a config

```bash
configdirector configs archive new-checkout
```

`configs archive` archives a config: it is removed from the project and from what SDKs receive, so applications get their in-code default value for it. It can be restored from the dashboard for 30 days, and after that it is deleted for good:

```txt
Archived new-checkout in web-app. It can be restored from the dashboard for 30 days.
```

It asks for no confirmation and does not check whether the code still reads the key, so run `configdirector scan` first. A renamed config can be archived by an old key. When no config in the project has the key, which includes a config already archived, it exits with 2. With `--json`, it prints `{ "archivedConfigKey": "new-checkout" }`, with the key as given.

`configs archive` needs `projects:read` and `configs:archive`. The change shows in the audit log with the source CLI.

## Options

| Option                        | Environment variable          | Meaning                                                                                                                                                           |
| ----------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--token <token>`             | `CONFIGDIRECTOR_TOKEN`        | API token. Without either, the sign-in saved by `login` for the organization named below is used, or the only sign-in.                                            |
| `--organization <name or id>` | `CONFIGDIRECTOR_ORGANIZATION` | The organization whose sign-in to use, by its saved name or its id. Without either, the `organization` in `configdirector.json`. Cannot be combined with a token. |
| `--base-url <url>`            | `CONFIGDIRECTOR_BASE_URL`     | API host. Defaults to `https://api.configdirector.com`.                                                                                                           |
| `--project <slug>`            | `CONFIGDIRECTOR_PROJECT`      | Project slug. Without either, every command that reads a project uses the `project` in `configdirector.json`.                                                     |
| `--json`                      |                               | Print JSON on stdout. Errors always go to stderr.                                                                                                                 |

The command exits with 0 when it succeeds, 1 when `validate` found a problem or `configs create` found a config that already has the key, and 2 when it could not run: a usage mistake, a rejected token, a suspended service, an unreachable API, or something the command names that does not exist, such as a config key, an environment, a saved context, a segment key, a tag or a scanned repository. `segments delete` also exits with 2 when the targeting rules of a config use the segment. A CI job can therefore tell a wrong config key from an outage.

## License

[MIT](LICENSE)
