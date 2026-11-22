import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  locale: "es-VE",
  timezoneId: "America/Caracas",
  viewport: { width: 1440, height: 1000 },
});
await page.goto("http://192.168.0.100:3000/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2500);

const cards = page.locator("#comparador article");
console.log("TARJETAS_COMPARADOR:", await cards.count());
console.log("ETIQUETAS_FAVORITO:", await page.getByText("Favorito", { exact: true }).count());
console.log("BADGE_SOLO_HOY:", await page.getByText("Solo hoy · VET").count());
console.log("PRIMERA_TARJETA:", (await cards.first().innerText()).slice(0, 260).replace(/\n/g, " | "));

await page.locator("#comparador").scrollIntoViewIfNeeded();
await page.screenshot({ path: "scripts/ui-verification.png", fullPage: false });
await browser.close();
