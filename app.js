import { createNodeMiddleware } from "@octokit/webhooks";
import dotenv from "dotenv";
import fs from "fs";
import http from "http";
import { App } from "octokit";

dotenv.config();

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

app.webhooks.on("pull_request.opened", handlePullRequestOpened);

async function handleIssueCommentCreated({ octokit, payload }) {
  if (!payload.issue.pull_request) return;
  if (payload.comment.user.login !== "mikeharder") return;

  console.log(
    `Received a PR comment from mikeharder on #${payload.issue.number}`,
  );

  try {
    await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: payload.issue.number,
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

app.webhooks.on("issue_comment.created", handleIssueCommentCreated);

app.webhooks.onError((error) => {
  if (error.name === "AggregateError") {
    console.error(`Error processing request: ${error.event}`);
  } else {
    console.error(error);
  }
});

const port = 3000;
const host = "localhost";
const path = "/api/webhook";
const localWebhookUrl = `http://${host}:${port}${path}`;

const middleware = createNodeMiddleware(app.webhooks, { path });

http.createServer(middleware).listen(port, () => {
  console.log(`Server is listening for events at: ${localWebhookUrl}`);
  console.log("Press Ctrl + C to quit.");
});
