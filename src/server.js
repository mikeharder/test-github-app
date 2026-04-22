import { useAzureMonitor } from "@azure/monitor-opentelemetry";
import { createNodeMiddleware } from "@octokit/webhooks";
import { trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { readFile } from "fs/promises";
import { createServer } from "http";
import { App } from "octokit";
import { logger } from "./logger.js";

// TODO: Move webhook_secret and certificate to KV
// TODO: Deploy to app service
// TODO: Send events from test repo to app service (in addition to dev machine)
// TODO: Add unit tests

if (!process.env.CLIENT_ID) {
  throw new Error("CLIENT_ID is not set");
}
if (!process.env.WEBHOOK_SECRET) {
  throw new Error("WEBHOOK_SECRET is not set");
}
if (!process.env.PRIVATE_KEY_PATH) {
  throw new Error("PRIVATE_KEY_PATH is not set");
}

if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
  useAzureMonitor({ enableLiveMetrics: true });
  registerInstrumentations({
    instrumentations: [new UndiciInstrumentation()],
  });
  console.log("Azure Monitor OpenTelemetry enabled (with undici/fetch)");
} else {
  console.log("APPLICATIONINSIGHTS_CONNECTION_STRING not set; skipping Azure Monitor");
}

const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "localhost";
const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const clientId = process.env.CLIENT_ID;
const webhookSecret = process.env.WEBHOOK_SECRET;
const privateKeyPath = process.env.PRIVATE_KEY_PATH;

const privateKey = await readFile(privateKeyPath, "utf8");

const app = new App({
  appId: clientId,
  privateKey: privateKey,
  webhooks: {
    secret: webhookSecret,
  },
});

const messageForNewPRs = "test comment from github app";

/**
 * @param {object} event
 * @param {import("octokit").Octokit} event.octokit
 * @param {import("@octokit/webhooks").EmitterWebhookEvent<"pull_request.opened">["payload"]} event.payload
 */
async function handlePullRequestOpened({ octokit, payload }) {
  console.log(`Received a pull request event for #${payload.pull_request.number}`);

  try {
    await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.pull_request.number,
      body: messageForNewPRs,
      headers: {
        "x-github-api-version": "2026-03-10",
      },
    });
  } catch (error) {
    if (error instanceof Error && "response" in error) {
      const err = /** @type {{ response: { status: number; data: { message: string } } }} */ (
        error
      );
      console.error(`Error! Status: ${err.response.status}. Message: ${err.response.data.message}`);
    }
    console.error(error);
  }
}

/**
 * @param {object} event
 * @param {import("octokit").Octokit} event.octokit
 * @param {import("@octokit/webhooks").EmitterWebhookEvent<"issue_comment.created">["payload"]} event.payload
 */
async function handleIssueCommentCreated({ octokit, payload }) {
  const span = trace.getActiveSpan();
  span?.setAttributes({
    issue_number: payload.issue?.number,
  });

  logger.emit({
    severityNumber: SeverityNumber.INFO,
    body: JSON.stringify(payload),
    attributes: {
      issue_number: payload.issue?.number,
      "github.event": "issue_comment.created",
    },
  });

  if (!payload.issue.pull_request) return;
  if (payload.comment.body !== "trigger") return;

  console.log(`Received a "trigger" PR comment on #${payload.issue.number}`);

  const triggerTime = new Date(payload.comment.created_at);
  const currentTime = new Date();
  const gapSeconds = (currentTime.getTime() - triggerTime.getTime()) / 1000;
  const body = [
    `Triggering comment time: ${triggerTime.toISOString()}`,
    `Current time: ${currentTime.toISOString()}`,
    `Gap (seconds): ${gapSeconds}`,
  ].join("\n");

  try {
    await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.issue.number,
      body: body,
      headers: {
        "x-github-api-version": "2026-03-10",
      },
    });
  } catch (error) {
    if (error instanceof Error && "response" in error) {
      const err = /** @type {{ response: { status: number; data: { message: string } } }} */ (
        error
      );
      console.error(`Error! Status: ${err.response.status}. Message: ${err.response.data.message}`);
    }
    console.error(error);
  }
}

app.webhooks.on("pull_request.opened", handlePullRequestOpened);
app.webhooks.on("issue_comment.created", handleIssueCommentCreated);
app.webhooks.onError((error) => {
  if (error.name === "AggregateError") {
    console.error(`Error processing request: ${JSON.stringify(error.event)}`);
  } else {
    console.error(error);
  }
});

const path = "/api/webhook";
const localWebhookUrl = `http://${host}:${port}${path}`;

const middleware = createNodeMiddleware(app.webhooks, { path });

createServer((req, res) => {
  console.log(
    `${new Date().toISOString()} ${req.method} ${req.url} from ${req.socket.remoteAddress}`,
  );
  middleware(req, res).catch((error) => {
    console.error(error);
    res.writeHead(500);
    res.end();
  });
}).listen(port, host, () => {
  console.log(`Server is listening for events at: ${localWebhookUrl}`);
  console.log("Press Ctrl + C to quit.");
});
