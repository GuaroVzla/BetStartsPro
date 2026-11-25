import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function run(args) {
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

test("validador acepta payload flashscore seed con allow-stale", () => {
  const r = run(["scripts/validate-ingest-payload.mjs", "--kind", "flashscore", "--allow-stale", "scripts/flashscore-payload.json"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /VALIDO/);
});

test("validador acepta payload curated ejemplo", () => {
  const r = run(["scripts/validate-ingest-payload.mjs", "--kind", "curated", "--allow-stale", "scripts/etl-sample-curated.json"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
});
