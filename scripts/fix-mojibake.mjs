import fs from "node:fs";

const cp1252 = {
  "\u20AC": 0x80, "\u201A": 0x82, "\u0192": 0x83, "\u201E": 0x84,
  "\u2026": 0x85, "\u2020": 0x86, "\u2021": 0x87, "\u02C6": 0x88,
  "\u2030": 0x89, "\u0160": 0x8A, "\u2039": 0x8B, "\u0152": 0x8C,
  "\u017D": 0x8E, "\u2018": 0x91, "\u2019": 0x92, "\u201C": 0x93,
  "\u201D": 0x94, "\u2022": 0x95, "\u2013": 0x96, "\u2014": 0x97,
  "\u02DC": 0x98, "\u2122": 0x99, "\u0161": 0x9A, "\u203A": 0x9B,
  "\u0153": 0x9C, "\u017E": 0x9E, "\u0178": 0x9F,
};

const file = process.argv[2];
const write = process.argv.includes("--write");
if (!file) {
  console.error("uso: node scripts/fix-mojibake.mjs <archivo> [--write]");
  process.exit(1);
}

const text = fs.readFileSync(file, "utf8");
const bytes = [];
for (const ch of text) {
  const code = ch.codePointAt(0);
  if (code <= 0xff) bytes.push(code);
  else if (cp1252[ch] !== undefined) bytes.push(cp1252[ch]);
  else bytes.push(0x3f);
}
const decoded = Buffer.from(bytes).toString("utf8");
const replacements = (decoded.match(/\uFFFD/g) || []).length;
const bad = decoded.indexOf("\uFFFD");

if (replacements > 0) {
  console.error(`No se escribió: ${replacements} caracteres no decodificables.`);
  console.error(JSON.stringify(decoded.slice(Math.max(0, bad - 80), bad + 80)));
  process.exit(2);
}

if (write) {
  fs.writeFileSync(file, decoded, "utf8");
  console.log(`Reparado ${file} (${text.length} -> ${decoded.length} caracteres).`);
} else {
  console.log("Vista previa (primeras 40 líneas):");
  console.log(decoded.split("\n").slice(0, 40).join("\n"));
}
