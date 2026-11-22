import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  locale: "es-VE",
  timezoneId: "America/Caracas",
  viewport: { width: 1440, height: 1000 },
});
await page.goto("http://192.168.0.100:3000/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2500);

const hoyVET = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Caracas",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const cards = page.locator("#radar article");
const total = await cards.count();
const fechas = new Map();
const textos = [];
for (let i = 0; i < total; i++) {
  const text = (await cards.nth(i).innerText()).replace(/\n/g, " | ");
  const m = text.match(/(lun|mar|mi[eé]|jue|vie|s[aá]b|dom),?\s*(\d{1,2})\s+([a-z[A-ZÀ-ÿ]+)/i);
  const key = m ? `${m[1]} ${m[2]} ${m[3]}` : "SIN_FECHA";
  fechas.set(key, (fechas.get(key) ?? 0) + 1);
  if (textos.length < 5) textos.push(text.slice(0, 200));
}

console.log("HOY_VET:", hoyVET);
console.log("TARJETAS_RADAR:", total);
console.log("FECHAS_MOSTRADAS:", JSON.stringify([...fechas.entries()], null, 2));
console.log("MUESTRAS:", JSON.stringify(textos, null, 2));

// Comparar con los datos crudos de /api/matches
const data = await page.evaluate(async () => {
  const r = await fetch("/api/matches", { cache: "no-store" });
  return r.json();
});
const matches = data.matches ?? [];
const fs = matches.filter((m) => m.id.startsWith("flashscore-"));
const datesVET = new Map();
for (const m of matches) {
  const d = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(m.commenceTime));
  datesVET.set(d, (datesVET.get(d) ?? 0) + 1);
}
console.log("API_TOTAL:", matches.length, "FLASHSCORE:", fs.length);
console.log("API_FECHAS_VET:", JSON.stringify([...datesVET.entries()]));

await browser.close();
