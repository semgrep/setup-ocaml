// Windows dune cache backed by a virtual disk image (VHDX).
//
// On Windows the dune cache is a tree of hundreds of thousands of tiny
// content-addressed files. Saving/restoring it as a tar archive via
// `@actions/cache` is dominated by NTFS per-file metadata cost, so the restore
// can take tens of minutes. Instead we keep the whole cache inside a single
// dynamically-sized VHDX and cache that one file: "restore" becomes attaching
// the image and "save" becomes detaching it, both O(1) in the number of files
// the image contains.
//
// We drive everything through `diskpart`, which ships with every Windows
// install — unlike the `Hyper-V` PowerShell module (`New-VHD`/`Mount-VHD`),
// which is not guaranteed to be present on CI runners.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as core from "@actions/core";
import { exec } from "@actions/exec";
import { DUNE_CACHE_ROOT, DUNE_CACHE_VHDX_MAX_SIZE_MB, DUNE_CACHE_VHDX_PATH } from "./constants.js";

// Run a diskpart script. diskpart reads its commands from a file (`/s`), so we
// stage the script in a temp file and clean it up afterwards.
async function runDiskpart(commands: string[]) {
  const scriptPath = path.join(os.tmpdir(), `setup-ocaml-dune-vhdx-${process.pid}.txt`);
  await fs.writeFile(scriptPath, `${commands.join("\n")}\n`);
  try {
    await exec("diskpart", ["/s", scriptPath]);
  } finally {
    await fs.rm(scriptPath, { force: true });
  }
}

// Create a fresh, empty dune cache image and mount it at DUNE_CACHE_ROOT.
// Used on a cache miss (no image was restored). The image is `expandable`, so
// the on-disk file only grows to the space actually used, up to the maximum.
export async function createDuneCacheVhdx() {
  await fs.mkdir(DUNE_CACHE_ROOT, { recursive: true });
  await runDiskpart([
    `create vdisk file="${DUNE_CACHE_VHDX_PATH}" maximum=${DUNE_CACHE_VHDX_MAX_SIZE_MB} type=expandable`,
    `select vdisk file="${DUNE_CACHE_VHDX_PATH}"`,
    "attach vdisk",
    "create partition primary",
    'format fs=ntfs quick label="dune"',
    // Mount the volume at an (empty) NTFS folder so DUNE_CACHE_ROOT is unchanged
    // for the rest of the action.
    `assign mount="${DUNE_CACHE_ROOT}"`,
  ]);
}

// Attach a previously-cached dune cache image and mount it at DUNE_CACHE_ROOT.
// Used on a cache hit (the .vhdx file was restored to disk).
export async function attachDuneCacheVhdx() {
  await fs.mkdir(DUNE_CACHE_ROOT, { recursive: true });
  await runDiskpart([
    `select vdisk file="${DUNE_CACHE_VHDX_PATH}"`,
    "attach vdisk",
    // The image already contains a formatted partition; just re-establish the
    // mount path (access paths are not persisted across runners).
    "select partition 1",
    `assign mount="${DUNE_CACHE_ROOT}"`,
  ]);
}

// Detach the image so the .vhdx file is flushed, consistent, and unlocked
// before it is handed to `@actions/cache`. Best-effort: a failure here must not
// prevent the (still-valid) image file from being saved.
export async function detachDuneCacheVhdx() {
  try {
    await runDiskpart([`select vdisk file="${DUNE_CACHE_VHDX_PATH}"`, "detach vdisk"]);
  } catch (error) {
    if (error instanceof Error) {
      core.warning(`Failed to detach dune cache VHDX before saving: ${error.message}`);
    }
  }
}
