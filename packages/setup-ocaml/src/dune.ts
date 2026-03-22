import * as core from "@actions/core";
import { exec } from "@actions/exec";
import * as github from "@actions/github";

export async function installDune() {
  await core.group("Installing dune", async () => {
    await exec("opam", ["install", "dune"]);
  });
}
