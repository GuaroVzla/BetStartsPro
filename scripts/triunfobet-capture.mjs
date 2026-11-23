#!/usr/bin/env node
/** Atajo: captura de Triunfobet (widget Altenar). Ver bookmaker-capture.mjs. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./bookmaker-capture.mjs", import.meta.url));
const result = spawnSync(
  process.execPath,
  [script, "--casa", "triunfobet", ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
