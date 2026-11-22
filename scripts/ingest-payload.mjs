import { readFile } from "node:fs/promises";

const FILE = process.argv[2] ?? "scripts/flashscore-payload.json";
const URL = process.argv[3] ?? "http://localhost:3000/api/ingest";

const raw = await readFile(FILE, "utf8");
let payload;
try {
  payload = JSON.parse(raw);
} catch (e) {
  console.error("JSON_INVALIDO:", String(e));
  process.exit(1);
}

if (!payload.partidos?.length) {
  console.error("PAYLOAD_VACIO");
  process.exit(1);
}
const bad = payload.partidos.filter((p) => !p.equipo_local?.trim() || !p.equipo_visitante?.trim());
if (bad.length) {
  console.error("EQUIPOS_VACIOS:", bad.length);
  process.exit(1);
}

const response = await fetch(URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const text = await response.text();
console.log("HTTP_STATUS:", response.status);
console.log("RESPONSE:", text.slice(0, 1000));
process.exit(response.ok ? 0 : 1);
