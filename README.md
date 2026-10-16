# ConfigDirector CLI

`configdirector` is the command line tool for [ConfigDirector](https://www.configdirector.com), the managed configuration and feature flag service. It is in beta: commands and output may change before 1.0. This release signs in and links a repository to a project.

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

## Options

| Option             | Environment variable      | Meaning                                                        |
| ------------------ | ------------------------- | -------------------------------------------------------------- |
| `--token <token>`  | `CONFIGDIRECTOR_TOKEN`    | API token. Without either, the token saved by `login` is used. |
| `--base-url <url>` | `CONFIGDIRECTOR_BASE_URL` | API host. Defaults to `https://api.configdirector.com`.        |
| `--project <slug>` | `CONFIGDIRECTOR_PROJECT`  | Project slug.                                                  |
| `--json`           |                           | Print JSON on stdout. Errors always go to stderr.              |

The command exits with 0 when it succeeds and 2 when it could not run: a usage mistake, a rejected token, a suspended service or an unreachable API.

## License

[MIT](LICENSE)
