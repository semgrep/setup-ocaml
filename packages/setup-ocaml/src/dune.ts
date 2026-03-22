import * as core from "@actions/core";
import { exec } from "@actions/exec";
import * as github from "@actions/github";
import { retry } from "@octokit/plugin-retry";
import { GITHUB_TOKEN } from "./constants.js";

const {
  repo: { owner, repo },
  runId: run_id,
} = github.context;

export async function installDune() {
  await core.group("Installing dune", async () => {
    await exec("opam", ["install", "dune"]);
  });
}
