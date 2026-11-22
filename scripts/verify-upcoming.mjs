const response = await fetch("http://192.168.0.100:3000/api/matches", { cache: "no-store" });
const data = await response.json();
const matches = data.matches ?? [];
const now = Date.now();
const started = matches.filter((m) => {
  if (m.status !== "scheduled") return true;
  const t = new Date(m.commenceTime).getTime();
  return Number.isFinite(t) && t <= now;
});
const flashscore = matches.filter((m) => m.id.startsWith("flashscore-"));
console.log("NOW_VET:", new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas", dateStyle: "short", timeStyle: "medium" }).format(new Date()));
console.log("API_TOTAL:", matches.length, "FLASHSCORE:", flashscore.length);
console.log("YA_COMENZADOS_EN_API:", started.length);
console.log("PRIMEROS:", matches.slice(0, 5).map((m) => `${m.home.name} vs ${m.away.name} (${m.commenceTime})`).join(" | "));
console.log("WARNING:", data.meta?.warnings?.[0]);
