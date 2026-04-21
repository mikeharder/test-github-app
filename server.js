import { useAzureMonitor } from "@azure/monitor-opentelemetry";
import { createNodeMiddleware } from "@octokit/webhooks";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import dotenv from "dotenv";
import fs from "fs";
import http from "http";
import { App } from "octokit";

dotenv.config();

if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
  useAzureMonitor({ enableLiveMetrics: true });
  registerInstrumentations({
    instrumentations: [new UndiciInstrumentation()],
  });
  console.log("Azure Monitor OpenTelemetry enabled (with undici/fetch)");
} else {
  console.log(
    "APPLICATIONINSIGHTS_CONNECTION_STRING not set; skipping Azure Monitor",
  );
}

const hostname = process.env.HOSTNAME;
const port = process.env.PORT;
const appId = process.env.APP_ID;
const webhookSecret = process.env.WEBHOOK_SECRET;
const privateKeyPath = process.env.PRIVATE_KEY_PATH;

const privateKey = fs.readFileSync(privateKeyPath, "utf8");

const app = new App({
  appId: appId,
  privateKey: privateKey,
  webhooks: {
    secret: webhookSecret,
  },
});

const messageForNewPRs = "test comment from github app";

async function handlePullRequestOpened({ octokit, payload }) {
  console.log(
    `Received a pull request event for #${payload.pull_request.number}`,
  );

  try {
    await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: payload.pull_request.number,
        body: messageForNewPRs,
        headers: {
          "x-github-api-version": "2026-03-10",
        },
      },
    );
  } catch (error) {
    if (error.response) {
      console.error(
        `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`,
      );
    }
    console.error(error);
  }
}

async function handleIssueCommentCreated({ octokit, payload }) {
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
    await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: payload.issue.number,
        body: body,
        headers: {
          "x-github-api-version": "2026-03-10",
        },
      },
    );
  } catch (error) {
    if (error.response) {
      console.error(
        `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`,
      );
    }
    console.error(error);
  }
}

app.webhooks.on("pull_request.opened", handlePullRequestOpened);
app.webhooks.on("issue_comment.created", handleIssueCommentCreated);
app.webhooks.onError((error) => {
  if (error.name === "AggregateError") {
    console.error(`Error processing request: ${error.event}`);
  } else {
    console.error(error);
  }
});

const path = "/api/webhook";
const localWebhookUrl = `http://${hostname}:${port}${path}`;

const middleware = createNodeMiddleware(app.webhooks, { path });

http
  .createServer((req, res) => {
    console.log(
      `${new Date().toISOString()} ${req.method} ${req.url} from ${req.socket.remoteAddress}`,
    );
    middleware(req, res);
  })
  .listen(port, () => {
    console.log(`Server is listening for events at: ${localWebhookUrl}`);
    console.log("Press Ctrl + C to quit.");
  });
