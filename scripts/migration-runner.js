"use strict";
const http = require("node:http");
const { spawn } = require("node:child_process");

const port = Number(process.env.PORT || 10000);
let started = false;
let finished = false;
let exitCode = null;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(finished && exitCode !== 0 ? 500 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify({ service: "database-migration-worker", started, finished, exitCode }));
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});
server.listen(port, "0.0.0.0", () => {
  console.log("Migration worker health endpoint is listening.");
  if (!process.env.SOURCE_DATABASE_URL || !process.env.TARGET_DATABASE_URL) {
    console.log("Waiting for SOURCE_DATABASE_URL and TARGET_DATABASE_URL to be configured.");
    return;
  }
  if (started) return;
  started = true;
  console.log("Starting one-time database migration.");
  const child = spawn("/migration/migrate-to-neon.sh", [], {
    env: process.env,
    stdio: "inherit"
  });
  child.on("error", (err) => {
    console.error("Migration process could not start:", err.message);
    finished = true;
    exitCode = 1;
  });
  child.on("close", (code) => {
    finished = true;
    exitCode = code;
    console.log(code === 0 ? "Migration worker finished successfully." : "Migration worker failed. Review logs before retrying.");
  });
});
