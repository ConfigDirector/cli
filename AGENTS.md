# ConfigDirector CLI

## Instruction scope

Read `../AGENTS.md` if it exists and has not already been loaded. These repository instructions take precedence over parent instructions where they differ.

Also follow the Workflow Rules, Code Design, Writing and TypeScript Conventions sections of `../config-director/AGENTS.md`; this repository keeps no copy of them.

`@configdirector/cli`, the `configdirector` command: TypeScript on Node 20 or later, ESM, built with tsdown and published to npm under the `latest` dist-tag. The product definition is `product-documents/cli-definition.md` in the config-director repository; read its sections 3 to 5 before changing a command.

## Commands

```bash
yarn typecheck              # tsc --noEmit
yarn lint                   # eslint .
yarn format                 # prettier --write .
yarn test                   # vitest in watch mode
yarn ci:test                # vitest run
yarn build                  # tsdown into dist/configdirector.mjs
yarn pack:tarball           # pack the publishable tarball into package.tgz
yarn ci:test:packed-tarball # install package.tgz into an empty directory and run the binary
yarn ci:test:integration    # run the built binary against a real Admin API; skipped without CONFIGDIRECTOR_BASE_URL and CONFIGDIRECTOR_TOKEN
```

Run a single spec with `yarn vitest run test/login.spec.ts`.

## Conventions

- `src/main.ts` is the only file that reads `process`. It builds an `Invocation` (arguments, environment variables, working and home directories, platform, stdin, stdout, stderr) and passes it to `run`. Everything else reads the invocation; lint rejects `process` and `console` elsewhere in `src/`.
- `run.ts` resolves the global options once into a `CommandContext`: the base URL with its default, and the project slug from `--project` or `CONFIGDIRECTOR_PROJECT`. The token stays the raw `--token` value, because `login` falls back to the prompt while every other command uses `configuredApiToken` (`--token`, `CONFIGDIRECTOR_TOKEN`, then the CLI sign-in for the organization named by `--organization`, `CONFIGDIRECTOR_ORGANIZATION` or `organization` in `configdirector.json`, then the only sign-in). `login` keeps one sign-in per organization in `sign-ins.json` (`src/sign-ins/`), and the first read of the sign-ins moves the token an earlier version saved in `config.json`. An empty environment variable counts as unset (`nonEmptyVariable`), which is what CI sets for a missing secret.
- A command returns a `CommandOutput` holding its JSON, its human text and its exit code, and `run` prints the JSON or the text on stdout. Apart from commander's `--help` and `--version`, nothing else writes to stdout; prompts and errors go to stderr.
- Exit codes (`ExitCode`): 0 success, 1 `validate` found problems or `configs create` found the key taken, and 2 the command could not run (usage, auth or network). Throw a `CliError` subclass for every expected failure; `run` prints its message and exits 2. An unexpected exception prints its stack and also exits 2.
- Every Admin API call goes through `AdminApiClient`. It sends `Authorization: Bearer <token>`, `X-SourceClient: cli` and `User-Agent: configdirector-cli/<version>`, validates responses with valibot, and maps each failure class to its own error in `admin-api-errors.ts`. Declare only the response fields the CLI reads, so the API can add fields without breaking a released CLI.
- Runtime packages go in `dependencies`, which tsdown leaves external so `npm audit` sees them; everything else is a devDependency.
- The CLI never checks for updates and sends no telemetry.

## Tests

- Behavior specs call `run` with an invocation from `test/support/sandbox.ts` (temporary working and home directories, captured stdout and stderr) against a real HTTP stub of the Admin API from `test/support/stub-admin-api.ts`. Assert the exit code, stdout, stderr, the files written and the requests the stub received.
- Seed state through commands rather than files: run `login` to save a sign-in instead of writing `sign-ins.json`. Write the file directly only for states `login` never produces, such as invalid contents, permissions others can read, or the `config.json` an earlier version saved.
- `test/support/terminal-input.ts` stands in for a terminal, to test the hidden token prompt.
- `test/packed-tarball/` installs `package.tgz` with npm into an empty directory and runs the installed binary. Run `yarn build && yarn pack:tarball` first. CI runs it on Node 24 and again on Node 20.
- `test/integration/` runs the built `dist/configdirector.mjs` against a real Admin API, through the sandbox's temporary directories: `CONFIGDIRECTOR_BASE_URL` names the API, `CONFIGDIRECTOR_TOKEN` signs in, and `CONFIGDIRECTOR_PROJECT` picks the project when the token's organization has more than one. Without both variables the suite prints that it is skipped and exits 0. Each spec creates what it needs under a `cli-integration-test-` key or repository name and removes it when the test finishes, failures included, so the project stays empty between runs. Run `yarn build` first, then `yarn ci:test:integration`; against a local core-api, `CONFIGDIRECTOR_BASE_URL=http://localhost:3001 CONFIGDIRECTOR_TOKEN=<token> yarn ci:test:integration`, and against dev, `CONFIGDIRECTOR_BASE_URL=https://api.configdirector-dev.com` with a dev token. The token needs `projects:read`, `environments:read`, `configs:read`, `configs:create`, `configs:archive`, `config-targeting-rules:update`, `segments:read`, `segments:create`, `segments:update`, `segments:delete`, `code-references:read` and `code-references:update`. In CI, the `integration-tests` job of `ci.yml` runs the suite against dev with the `CONFIGDIRECTOR_DEV_API_TOKEN` secret (production is not tested for now), on every push here and when the config-director `Deploy` workflow triggers it after deploying core-api to dev; a failure on `main` opens or updates the `ci-failure` issue, and the next passing run closes it.

## Releasing

- Every user-visible change gets an entry in `CHANGELOG.md` under `## [Unreleased]`, in Keep a Changelog sections (Added, Changed, Fixed), written from the user's side.
- To release, set `version` in `package.json`, move the Unreleased entries under that version, and run the `Release` workflow from GitHub Actions. It runs `yarn release`, publishes `package.tgz` to npm under `latest` through trusted publishing, tags the commit `cli-v<version>`, and points the formula in `ConfigDirector/homebrew-tap` (`../homebrew-tap`) at the new tarball, with the `HOMEBREW_TAP_TOKEN` secret, a fine-grained token with Contents read and write on that repository only. When the formula step fails, npm already has the release; the log names the `url` and `sha256` to commit to the tap by hand.
- Versions are plain `0.x.y` until 1.0, never a prerelease such as `-beta.1`: when a user's `.npmrc` sets `min-release-age`, npm falls back from a release too new to install to the newest older plain version, but never to an older prerelease, so a prerelease fails every install until it is old enough.
