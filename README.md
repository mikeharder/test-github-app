# test-github-app

A minimal [GitHub App](https://docs.github.com/en/apps) used for experimentation and testing. It
runs a Node.js HTTP server that listens for GitHub webhook events and responds using the GitHub REST
API via [Octokit](https://github.com/octokit/octokit.js). It is also instrumented with
[Azure Monitor OpenTelemetry](https://learn.microsoft.com/azure/azure-monitor/app/opentelemetry-enable)
for traces, logs, and live metrics.

This document is for developer contributors: how to set the project up locally, build, lint, test,
run, and where deployment is headed.

## What it does

The webhook server (`src/server.ts`) handles two events:

- **`pull_request.opened`** — posts a `test comment from github app` comment on the new pull request.
- **`issue_comment.created`** — when a comment with the body `trigger` is added to a pull request,
  it replies with the time the trigger comment was created, the current time, and the gap in seconds.

The same `trigger` behavior is also implemented as a GitHub Actions workflow (`.github/workflows/pr-comment.yaml`)
that uses the `gh` CLI, so the two paths can be compared.

## Tech stack

- **Runtime:** Node.js (`>=24.14.1`; CI uses Node 24.14.1).
- **Language:** TypeScript, run directly via Node's native type stripping — there is **no compile/emit step**.
  `tsconfig.json` is used for type-checking only (`noEmit`). Intra-repo imports use explicit `.ts` extensions.
- **Libraries:** `octokit` / `@octokit/webhooks`, `@azure/monitor-opentelemetry`, `smee-client` (dev).
- **Tooling:** [Vitest](https://vitest.dev/) (tests + coverage), ESLint (typed lint), Prettier (formatting).

## Prerequisites

- Node.js matching the `engines` range in `package.json`.
- A GitHub App registration (App/Client ID, webhook secret, and a private key `.pem` file).
- A [smee.io](https://smee.io/) channel URL to proxy webhook deliveries to your local machine (for
  local development).

## Setup

1. Install dependencies:

   ```sh
   npm ci
   ```

2. Create a `.env` file from the example and fill in your values:

   ```sh
   cp .env.example .env
   ```

   Environment variables:

   | Variable                                | Required           | Description                                                   |
   | --------------------------------------- | ------------------ | ------------------------------------------------------------- |
   | `CLIENT_ID`                             | Yes                | GitHub App ID / Client ID.                                    |
   | `WEBHOOK_SECRET`                        | Yes                | Secret used to verify incoming webhook signatures.            |
   | `PRIVATE_KEY_PATH`                      | Yes                | Path to the GitHub App private key `.pem` file.               |
   | `WEBHOOK_PROXY_URL`                     | For `npm run smee` | smee.io channel URL forwarded to the local server.            |
   | `APPLICATIONINSIGHTS_CONNECTION_STRING` | No                 | Enables Azure Monitor OpenTelemetry when set.                 |
   | `PORT`                                  | No                 | HTTP port (default `3000`).                                   |
   | `NODE_ENV`                              | No                 | When `production`, binds to `0.0.0.0` instead of `localhost`. |

   Private keys (`*.pem`) and `.env` files are git-ignored.

## Build / lint

There is no build artifact to produce. Use the lint scripts to type-check and check style:

```sh
npm run lint          # eslint + tsc --build (type-check only)
npm run lint:tsc      # type-check only
npm run lint:eslint   # eslint only
npm run format:check  # prettier --check
npm run format        # prettier --write (apply formatting)
```

## Test

```sh
npm test              # vitest in watch mode
npm run test:ci       # vitest run with coverage (verbose)
```

Tests live in `test/` and run against the TypeScript sources in `src/`.

To run the full validation suite (tests, lint, and format check) the same way CI does:

```sh
npm run check
```

## Run locally

The app needs webhook deliveries forwarded to your machine. In one terminal, start the smee proxy:

```sh
npm run smee
```

In another terminal, start the server:

```sh
npm start
```

The server listens at `http://localhost:3000/api/webhook` by default. Open a pull request or add a
`trigger` comment in the configured GitHub repository to exercise the handlers.

## Continuous integration

`.github/workflows/test.yaml` runs on pull requests and pushes to `main`, executing `npm run test:ci`,
`npm run lint`, and the format check on Node 24.14.1.

## Deployment

Deployment is still in progress. See the `TODO` notes at the top of `src/server.ts` — the intended
direction is to move the webhook secret and certificate to Azure Key Vault and host the server on
Azure App Service, with Azure Monitor OpenTelemetry already wired up for observability.
