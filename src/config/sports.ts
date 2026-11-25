import type { LeagueInfo, SportKey, SportMeta } from "@/types/sports";

export const SPORTS: SportMeta[] = [
  {
    key: "soccer",
    label: "Fútbol",
    shortLabel: "Fútbol",
    emoji: "⚽",
    accent: "#34d399",
    tagline: "Las cinco grandes ligas y la Champions",
  },
  {
    key: "basketball",
    label: "Básquet",
    shortLabel: "Básquet",
    emoji: "🏀",
    accent: "#fb923c",
    tagline: "NBA y Euroliga",
  },
  {
    key: "baseball",
    label: "Béisbol",
    shortLabel: "Béisbol",
    emoji: "⚾",
    accent: "#60a5fa",
    tagline: "MLB y ligas invernales",
  },
  {
    key: "hockey",
    label: "Hockey",
    shortLabel: "Hockey",
    emoji: "🏒",
    accent: "#a78bfa",
    tagline: "NHL sobre hielo",
  },
];

export const SPORT_BY_KEY: Record<SportKey, SportMeta> = {
  soccer: SPORTS[0],
  basketball: SPORTS[1],
  baseball: SPORTS[2],
  hockey: SPORTS[3],
};

export const ALL_SPORTS_LABEL = "Todos";

export function getCurrentSeason(sport: SportKey): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  if (sport === "soccer") {
    return String(month >= 6 ? year : year - 1);
  }

  if (sport === "baseball") {
    return String(year);
  }

  if (month >= 6) {
    return `${year}-${year + 1}`;
  }

  return `${year - 1}-${year}`;
}

const season = {
  soccer: getCurrentSeason("soccer"),
  basketball: getCurrentSeason("basketball"),
  baseball: getCurrentSeason("baseball"),
  hockey: getCurrentSeason("hockey"),
};

export const LEAGUES: LeagueInfo[] = [
  {
    id: "epl",
    sport: "soccer",
    oddsApiKey: "soccer_epl",
    apiSportsId: 39,
    sportmonksLeagueId: 8,
    espnPath: "soccer/eng.1",
    name: "Premier League",
    shortName: "EPL",
    country: "Inglaterra",
    season: season.soccer,
  },
  {
    id: "laliga",
    sport: "soccer",
    oddsApiKey: "soccer_spain_la_liga",
    apiSportsId: 140,
    espnPath: "soccer/esp.1",
    name: "LaLiga",
    shortName: "LaLiga",
    country: "España",
    season: season.soccer,
  },
  {
    id: "serie-a",
    sport: "soccer",
    oddsApiKey: "soccer_italy_serie_a",
    apiSportsId: 135,
    espnPath: "soccer/ita.1",
    name: "Serie A",
    shortName: "Serie A",
    country: "Italia",
    season: season.soccer,
  },
  {
    id: "bundesliga",
    sport: "soccer",
    oddsApiKey: "soccer_germany_bundesliga",
    apiSportsId: 78,
    sportmonksLeagueId: 82,
    espnPath: "soccer/ger.1",
    name: "Bundesliga",
    shortName: "Bundesliga",
    country: "Alemania",
    season: season.soccer,
  },
  {
    id: "champions",
    sport: "soccer",
    oddsApiKey: "soccer_uefa_champs_league",
    apiSportsId: 2,
    espnPath: "soccer/uefa.champions",
    name: "UEFA Champions League",
    shortName: "Champions",
    country: "Europa",
    season: season.soccer,
  },
  {
    id: "nba",
    sport: "basketball",
    oddsApiKey: "basketball_nba",
    apiSportsId: 12,
    espnPath: "basketball/nba",
    name: "NBA",
    shortName: "NBA",
    country: "Estados Unidos",
    season: season.basketball,
  },
  {
    id: "euroleague",
    sport: "basketball",
    oddsApiKey: "basketball_euroleague",
    apiSportsId: 120,
    espnPath: "basketball/euroleague",
    name: "Euroliga",
    shortName: "Euroliga",
    country: "Europa",
    season: season.basketball,
  },
  {
    id: "mlb",
    sport: "baseball",
    oddsApiKey: "baseball_mlb",
    apiSportsId: 1,
    espnPath: "baseball/mlb",
    name: "MLB",
    shortName: "MLB",
    country: "Estados Unidos",
    season: season.baseball,
  },
  {
    id: "lidom",
    sport: "baseball",
    oddsApiKey: "baseball_lidom",
    apiSportsId: 17,
    espnPath: "baseball/dominican-winter-league",
    name: "LIDOM",
    shortName: "LIDOM",
    country: "República Dominicana",
    season: season.baseball,
  },
  {
    id: "nhl",
    sport: "hockey",
    oddsApiKey: "icehockey_nhl",
    apiSportsId: 57,
    espnPath: "hockey/nhl",
    name: "NHL",
    shortName: "NHL",
    country: "Estados Unidos / Canadá",
    season: season.hockey,
  },
];

export const LEAGUES_BY_SPORT = LEAGUES.reduce(
  (acc, league) => {
    acc[league.sport].push(league);
    return acc;
  },
  {
    soccer: [],
    basketball: [],
    baseball: [],
    hockey: [],
  } as Record<SportKey, LeagueInfo[]>,
);

export const SPORT_LEAGUE_COUNT = LEAGUES.reduce(
  (acc, league) => {
    acc[league.sport] += 1;
    return acc;
  },
  {
    soccer: 0,
    basketball: 0,
    baseball: 0,
    hockey: 0,
  } as Record<SportKey, number>,
);
