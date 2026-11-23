#!/usr/bin/env node
/** Atajo: captura de Apuestas Royal (requiere --url verificado). Ver bookmaker-capture.mjs. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./bookmaker-capture.mjs", import.meta.url));
const result = spawnSync(
  process.execPath,
  [script, "--casa", "apuestas-royal", ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
