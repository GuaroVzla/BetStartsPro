import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  locale: "es-VE",
  timezoneId: "America/Caracas",
  viewport: { width: 1440, height: 1000 },
});
await page.goto("http://192.168.0.100:3000/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2000);

const comparador = page.locator("#comparador article");
const n = await comparador.count();
const primeros = [];
for (let i = 0; i < Math.min(n, 5); i++) {
  primeros.push((await comparador.nth(i).innerText()).replace(/\n/g, " | ").slice(0, 140));
}
console.log("HOY_VET:", new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas", dateStyle: "short", timeStyle: "medium" }).format(new Date()));
console.log("TARJETAS_COMPARADOR:", n);
console.log("RADAR_TARJETAS:", await page.locator("#radar article").count());
console.log("BADGE_PENDIENTES:", await page.locator("#comparador").getByText("Solo hoy · VET · Pendientes").count());
console.log("PRIMERAS_TARJETAS:", JSON.stringify(primeros, null, 2));
await browser.close();
