import { readFile } from "node:fs/promises";

const FILE = process.argv[2] ?? "scripts/triunfobet-quotes.json";
const URL = process.argv[3] ?? "http://localhost:3000/api/ingest/triunfobet";

let payload;
try {
  payload = JSON.parse(await readFile(FILE, "utf8"));
} catch (error) {
  console.error("JSON_INVALIDO:", String(error));
  process.exit(1);
}

if (!Array.isArray(payload.cotizaciones) || payload.cotizaciones.length === 0) {
  console.error("SIN_COTIZACIONES: el archivo no contiene cotizaciones visibles");
  process.exit(1);
}

const response = await fetch(URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const text = await response.text();
console.log("HTTP_STATUS:", response.status);
console.log("RESPONSE:", text.slice(0, 1200));
process.exit(response.ok ? 0 : 1);
