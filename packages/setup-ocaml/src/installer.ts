import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as process from "node:process";
import * as core from "@actions/core";
import { exec } from "@actions/exec";
import { restoreDuneCache, restoreOpamCaches, saveOpamCache } from "./cache.js";
import {
  CYGWIN_ROOT,
  CYGWIN_ROOT_BIN,
  DUNE_CACHE,
  DUNE_CACHE_ROOT,
  OPAM_PIN,
  OPAM_REPOSITORIES,
  OPAM_ROOT,
  PLATFORM,
  SAVE_OPAM_POST_RUN,
} from "./constants.js";
import { installDune } from "./dune.js";
import {
  installOcaml,
  pin,
  repositoryAddAll,
  repositoryRemoveAll,
  setupOpam,
  update,
} from "./opam.js";
import { retrieveOpamLocalPackages } from "./packages.js";
import { resolvedCompiler } from "./version.js";

export async function installer() {
  if (core.isDebug()) {
    core.exportVariable("OPAMVERBOSE", 1);
  }
  core.exportVariable("OPAMCOLOR", "always");
  core.exportVariable("OPAMCONFIRMLEVEL", "unsafe-yes");
  core.exportVariable("OPAMDOWNLOADJOBS", os.availableParallelism());
  core.exportVariable("OPAMERRLOGLEN", 0);
  core.exportVariable("OPAMEXTERNALSOLVER", "builtin-0install");
  core.exportVariable("OPAMPRECISETRACKING", 1);
  core.exportVariable("OPAMRETRIES", 10);
  core.exportVariable("OPAMROOT", OPAM_ROOT);
  core.exportVariable("OPAMSOLVERTIMEOUT", 600);
  core.exportVariable("OPAMYES", 1);
  if (PLATFORM === "windows") {
    core.exportVariable("CYGWIN", "winsymlinks:native");
    core.exportVariable("HOME", process.env.USERPROFILE);
    core.exportVariable("MSYS", "winsymlinks:native");
    await core.group("Configuring Windows symlink settings", async () => {
      await exec("fsutil", ["behavior", "query", "SymlinkEvaluation"]);
      // [INFO] https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/fsutil-behavior
      await exec("fsutil", [
        "behavior",
        "set",
        "symlinkEvaluation",
        "R2L:1",
        "R2R:1",
      ]);
      await exec("fsutil", ["behavior", "query", "SymlinkEvaluation"]);
    });
  }
  const { opamCacheHit } = await restoreOpamCaches();
  await setupOpam();
  if (PLATFORM === "windows") {
    const bashEnvPath = path.join(CYGWIN_ROOT, "bash_env");
    await fs.writeFile(bashEnvPath, "set -o igncr");
    core.exportVariable("BASH_ENV", bashEnvPath);
    core.addPath(CYGWIN_ROOT_BIN);
  }
  await repositoryRemoveAll();
  await repositoryAddAll(OPAM_REPOSITORIES);
  if (!opamCacheHit) {
    const ocamlCompiler = await resolvedCompiler;
    await installOcaml(ocamlCompiler);
    if (!SAVE_OPAM_POST_RUN) {
      await saveOpamCache();
    }
  } else {
    await update();
  }
  if (DUNE_CACHE) {
    await restoreDuneCache();
    await installDune();
    core.exportVariable("DUNE_CACHE_ROOT", DUNE_CACHE_ROOT);
  }
  core.exportVariable("CLICOLOR_FORCE", "1");
  if (OPAM_PIN) {
    const fnames = await retrieveOpamLocalPackages();
    await pin(fnames);
  }
  await exec("opam", ["config", "report"]);
}
