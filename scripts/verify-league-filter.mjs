import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  locale: "es-VE",
  timezoneId: "America/Caracas",
  viewport: { width: 1440, height: 1000 },
});
await page.goto("http://192.168.0.100:3000/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2000);

const cards = page.locator("#comparador article");
const select = page.locator("#league-filter");
const options = await select.locator("option").allTextContents();
console.log("LIGAS_EN_SELECTOR:", options.length - 1);
console.log("TODAS_INICIALES:", await cards.count());

const leagueValue = await select.locator("option").nth(1).getAttribute("value");
await select.selectOption(leagueValue);
await page.waitForTimeout(300);
const leagueLabel = options[1];
const filteredCount = await cards.count();
const leagueName = leagueLabel.split(" · ")[0];
let coincidencias = 0;
for (let i = 0; i < filteredCount; i += 1) {
  const text = await cards.nth(i).innerText();
  if (text.includes(leagueName)) coincidencias += 1;
}
console.log("LIGA_ELEGIDA:", leagueLabel);
console.log("TARJETAS_FILTRADAS:", filteredCount, "COINCIDEN:", coincidencias);

await select.selectOption("all");
await page.getByRole("button", { name: /Solo fútbol/i }).click();
await page.waitForTimeout(300);
const soccerCount = await cards.count();
let soloFutbol = 0;
for (let i = 0; i < soccerCount; i += 1) {
  const text = await cards.nth(i).innerText();
  if (text.includes("FÚTBOL")) soloFutbol += 1;
}
console.log("SOLO_FUTBOL_TARJETAS:", soccerCount, "FUTBOL:", soloFutbol);
console.log("RADAR_SELECTOR:", await page.locator("#radar-sport").inputValue());

console.log("HEMBRA_COMPARADOR:", await page.locator("#comparador").getByText("Hembra", { exact: true }).count());
console.log("HEMBRA_RADAR:", await page.locator("#radar").getByText(/Hembra/).count());
console.log("FAVORITOS_COMPARADOR:", await page.locator("#comparador").getByText("Favorito", { exact: true }).count());
console.log("RADAR_TARJETAS:", await page.locator("#radar article").count());
console.log("EN_VIVO:", await page.locator("#comparador").getByText("En vivo", { exact: true }).count());
await browser.close();
