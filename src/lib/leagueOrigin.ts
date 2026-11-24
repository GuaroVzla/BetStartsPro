import type { LeagueInfo } from "@/types/sports";

/**
 * Origen de una liga: país (con bandera e ISO) o competición internacional.
 * La inferencia cubre los datos existentes, donde `country` puede venir en
 * mayúsculas, vacío o con valores binacionales ("Estados Unidos / Canadá").
 */

export interface LeagueOrigin {
  isInternational: boolean;
  label: string;
  flag: string | null;
  iso2: string | null;
}

const PAISES: Record<string, { label: string; iso2: string }> = {
  alemania: { label: "Alemania", iso2: "DE" },
  argentina: { label: "Argentina", iso2: "AR" },
  brasil: { label: "Brasil", iso2: "BR" },
  chile: { label: "Chile", iso2: "CL" },
  colombia: { label: "Colombia", iso2: "CO" },
  escocia: { label: "Escocia", iso2: "GB" },
  espana: { label: "España", iso2: "ES" },
  estadosunidos: { label: "Estados Unidos", iso2: "US" },
  francia: { label: "Francia", iso2: "FR" },
  gales: { label: "Gales", iso2: "GB" },
  inglaterra: { label: "Inglaterra", iso2: "GB" },
  irlandadelnorte: { label: "Irlanda del Norte", iso2: "GB" },
  italia: { label: "Italia", iso2: "IT" },
  japon: { label: "Japón", iso2: "JP" },
  martinica: { label: "Martinica", iso2: "MQ" },
  mexico: { label: "México", iso2: "MX" },
  paisesbajos: { label: "Países Bajos", iso2: "NL" },
  portugal: { label: "Portugal", iso2: "PT" },
  republicadominicana: { label: "República Dominicana", iso2: "DO" },
  venezuela: { label: "Venezuela", iso2: "VE" },
};

const INTERNACIONALES = new Set([
  "europa",
  "europe",
  "internacional",
  "international",
  "mundial",
  "mundo",
  "world",
  "global",
]);

const NOMBRE_INTERNACIONAL =
  /champions league|europa league|conference league|libertadores|copa america|mundial|world cup|internacional|international|olimpic|uefa|conmebol|euroliga|euroleague|\bNBA\b|\bNHL\b/i;

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function banderaIso2(iso2: string): string {
  return iso2
    .toUpperCase()
    .split("")
    .map((letra) => String.fromCodePoint(0x1f1e6 + letra.charCodeAt(0) - 65))
    .join("");
}

/** País con bandera o badge de torneo internacional. */
export function leagueOrigin(league: LeagueInfo): LeagueOrigin {
  const nombre = `${league.name ?? ""} ${league.shortName ?? ""}`;
  const paisNormalizado = normalizar(league.country ?? "");

  let isInternational = league.isInternational === true;
  if (league.isInternational !== true && league.isInternational !== false) {
    isInternational =
      paisNormalizado.length === 0 ||
      INTERNACIONALES.has(paisNormalizado) ||
      league.country?.includes("/") === true ||
      NOMBRE_INTERNACIONAL.test(nombre);
  }

  if (isInternational) {
    return { isInternational: true, label: "Internacional", flag: "🌐", iso2: null };
  }

  const pais = PAISES[paisNormalizado];
  if (!pais) {
    return {
      isInternational: false,
      label: league.country?.trim() || "Sin país",
      flag: "🏳️",
      iso2: null,
    };
  }
  return {
    isInternational: false,
    label: pais.label,
    flag: banderaIso2(pais.iso2),
    iso2: pais.iso2,
  };
}
