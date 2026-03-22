import * as core from "@actions/core";
import { exec } from "@actions/exec";

export async function installDune() {
  await core.group("Installing dune", async () => {
    await exec("opam", ["install", "dune"]);
  });
}
