# Changelog

All notable changes to `@configdirector/cli` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `configdirector login` asks for an API token, checks that it can list your projects, and saves it for later runs where only you can read it. The token is hidden while you paste it. `configdirector login --token <token>` saves a token without asking.
- `configdirector init --project <slug>` writes `configdirector.json`, linking the current directory to one of your projects. It never overwrites an existing file.
- Every command accepts `--token`, `--base-url`, `--project` and `--json`. The token comes from `--token`, then `CONFIGDIRECTOR_TOKEN`, then the token saved by `login`. `CONFIGDIRECTOR_BASE_URL` and `CONFIGDIRECTOR_PROJECT` stand in for the other two options, and an empty variable counts as unset.
- Exit code 0 means the command succeeded, and 2 means it could not run: a usage mistake, a rejected token, a suspended service or an unreachable API. Errors go to stderr, so with `--json` the JSON is all that reaches stdout.
