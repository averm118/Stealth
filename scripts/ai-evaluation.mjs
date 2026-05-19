import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const supplyResume = readFileSync(join(root, "tests/fixtures/resumes/supply-chain-operations.txt"), "utf8").toLowerCase();
const softwareResume = readFileSync(join(root, "tests/fixtures/resumes/software-ai-intern.txt"), "utf8").toLowerCase();
const supplyJob = JSON.parse(readFileSync(join(root, "tests/fixtures/jobs/supply-chain-intern.json"), "utf8"));
const softwareJob = JSON.parse(readFileSync(join(root, "tests/fixtures/jobs/software-intern.json"), "utf8"));

const hardSoftwareSignals = [
  "software engineer",
  "software engineering",
  "backend",
  "frontend",
  "full-stack",
  "full stack",
  "react",
  "typescript",
  "javascript",
  "node",
  "github",
  "deployed",
  "web app"
];

const supplySignals = ["supply chain", "inventory", "forecasting", "operations", "supplier"];

assert.equal(
  hardSoftwareSignals.some((signal) => supplyResume.includes(signal)),
  false,
  "Supply chain fixture must not contain hard software evidence."
);

assert.equal(
  hardSoftwareSignals.some((signal) => softwareResume.includes(signal)),
  true,
  "Software fixture must contain hard software evidence."
);

assert.equal(
  supplySignals.some((signal) => supplyResume.includes(signal)),
  true,
  "Supply chain fixture must contain role-category evidence."
);

assert.match(supplyJob.title, /intern/i, "Internship fixture should exercise internship preference.");
assert.match(softwareJob.title, /software/i, "Software fixture should exercise software role gating.");
assert.equal(supplyJob.skills.includes("react"), false, "Missing software skills should remain gaps for supply chain resumes.");

console.log("AI reliability fixtures passed.");
