import { LEAGUES } from "@/config/sports";
import { summarizeMarket } from "@/lib/marketSummary";
import { clamp, initials } from "@/lib/utils";
import type {
  BookmakerQuote,
  DashboardData,
  FormResult,
  Injury,
  InjuryImpact,
  LeagueInfo,
  MatchIntel,
  OddsSource,
  SportKey,
  SportsMatch,
  StandingRow,
  TeamAdvancedStats,
  TeamRef,
  VenueSplit,
} from "@/types/sports";

interface TeamSeed {
  id: string;
  name: string;
  shortName: string;
  color: string;
  secondaryColor: string;
  position: number;
  group?: string;
  played: number;
  wins: number;
  draws?: number;
  losses: number;
  points?: number;
  scored: number;
  conceded: number;
  form: FormResult[];
}

interface InjurySeed {
  player: string;
  position: string;
  status: string;
  reason: string;
  impact: InjuryImpact;
}

interface FixtureSeed {
  homeId: string;
  awayId: string;
  venue: string;
  startOffsetMinutes: number;
  odds: {
    home: number;
    draw?: number;
    away: number;
  };
  injuries?: {
    home: InjurySeed[];
    away: InjurySeed[];
  };
}

interface LeagueSeed {
  leagueId: string;
  teams: TeamSeed[];
  fixtures: FixtureSeed[];
}

const BOOKMAKER_TEMPLATES: Array<{
  id: string;
  name: string;
  source: OddsSource;
  homeDelta: number;
  drawDelta: number;
  awayDelta: number;
}> = [
  {
    id: "draftkings",
    name: "DraftKings",
    source: "the-odds-api",
    homeDelta: 0.04,
    drawDelta: 0,
    awayDelta: 0.02,
  },
  {
    id: "fanduel",
    name: "FanDuel",
    source: "the-odds-api",
    homeDelta: 0.06,
    drawDelta: -0.02,
    awayDelta: -0.01,
  },
  {
    id: "pinnacle",
    name: "Pinnacle",
    source: "the-odds-api",
    homeDelta: 0.01,
    drawDelta: 0.03,
    awayDelta: 0.05,
  },
  {
    id: "bet365",
    name: "Bet365",
    source: "api-sports",
    homeDelta: -0.02,
    drawDelta: 0.05,
    awayDelta: 0.06,
  },
  {
    id: "onexbet",
    name: "1xBet",
    source: "api-sports",
    homeDelta: 0.08,
    drawDelta: -0.04,
    awayDelta: -0.03,
  },
];

const MOCK_LEAGUES: LeagueSeed[] = [
  {
    leagueId: "epl",
    teams: [
      {
        id: "arsenal",
        name: "Arsenal",
        shortName: "Arsenal",
        color: "#EF0107",
        secondaryColor: "#FFFFFF",
        position: 1,
        played: 12,
        wins: 9,
        draws: 2,
        losses: 1,
        points: 29,
        scored: 28,
        conceded: 10,
        form: ["W", "W", "W", "D", "W"],
      },
      {
        id: "liverpool",
        name: "Liverpool",
        shortName: "Liverpool",
        color: "#C8102E",
        secondaryColor: "#00B2A9",
        position: 2,
        played: 12,
        wins: 8,
        draws: 3,
        losses: 1,
        points: 27,
        scored: 26,
        conceded: 12,
        form: ["W", "D", "W", "W", "W"],
      },
      {
        id: "man-city",
        name: "Manchester City",
        shortName: "Man City",
        color: "#6CABDD",
        secondaryColor: "#1C2C5B",
        position: 3,
        played: 12,
        wins: 8,
        draws: 2,
        losses: 2,
        points: 26,
        scored: 30,
        conceded: 15,
        form: ["W", "W", "L", "W", "W"],
      },
      {
        id: "chelsea",
        name: "Chelsea",
        shortName: "Chelsea",
        color: "#034694",
        secondaryColor: "#FFFFFF",
        position: 4,
        played: 12,
        wins: 7,
        draws: 3,
        losses: 2,
        points: 24,
        scored: 24,
        conceded: 14,
        form: ["W", "D", "D", "W", "W"],
      },
      {
        id: "tottenham",
        name: "Tottenham Hotspur",
        shortName: "Tottenham",
        color: "#132257",
        secondaryColor: "#FFFFFF",
        position: 5,
        played: 12,
        wins: 6,
        draws: 2,
        losses: 4,
        points: 20,
        scored: 22,
        conceded: 18,
        form: ["L", "W", "W", "L", "W"],
      },
      {
        id: "newcastle",
        name: "Newcastle United",
        shortName: "Newcastle",
        color: "#241F20",
        secondaryColor: "#FFFFFF",
        position: 6,
        played: 12,
        wins: 5,
        draws: 3,
        losses: 4,
        points: 18,
        scored: 18,
        conceded: 16,
        form: ["D", "W", "L", "D", "W"],
      },
      {
        id: "aston-villa",
        name: "Aston Villa",
        shortName: "Villa",
        color: "#670E36",
        secondaryColor: "#95BFE5",
        position: 7,
        played: 12,
        wins: 5,
        draws: 3,
        losses: 4,
        points: 18,
        scored: 19,
        conceded: 17,
        form: ["W", "L", "D", "W", "L"],
      },
    ],
    fixtures: [
      {
        homeId: "arsenal",
        awayId: "liverpool",
        venue: "Emirates Stadium",
        startOffsetMinutes: 115,
        odds: { home: 2.08, draw: 3.55, away: 3.45 },
        injuries: {
          home: [
            {
              player: "Bukayo Saka",
              position: "Extremo derecho",
              status: "Duda",
              reason: "Sobrecarga isquiotibial",
              impact: "medium",
            },
            {
              player: "Gabriel Jesus",
              position: "Delantero",
              status: "Baja",
              reason: "Lesión de rodilla",
              impact: "low",
            },
          ],
          away: [
            {
              player: "Alisson Becker",
              position: "Portero",
              status: "Baja",
              reason: "Lesión muscular",
              impact: "high",
            },
          ],
        },
      },
      {
        homeId: "man-city",
        awayId: "chelsea",
        venue: "Etihad Stadium",
        startOffsetMinutes: 235,
        odds: { home: 1.9, draw: 3.8, away: 3.85 },
        injuries: {
          home: [
            {
              player: "Rodri",
              position: "Mediocentro",
              status: "Baja",
              reason: "Lesión de rodilla",
              impact: "high",
            },
          ],
          away: [
            {
              player: "Reece James",
              position: "Lateral derecho",
              status: "Duda",
              reason: "Molestias en el tendón de Aquiles",
              impact: "medium",
            },
          ],
        },
      },
    ],
  },
  {
    leagueId: "laliga",
    teams: [
      {
        id: "real-madrid",
        name: "Real Madrid",
        shortName: "Real Madrid",
        color: "#FEBE10",
        secondaryColor: "#1E3A8A",
        position: 1,
        played: 13,
        wins: 11,
        draws: 1,
        losses: 1,
        points: 34,
        scored: 31,
        conceded: 9,
        form: ["W", "W", "W", "W", "W"],
      },
      {
        id: "barcelona",
        name: "FC Barcelona",
        shortName: "Barcelona",
        color: "#A50044",
        secondaryColor: "#004D98",
        position: 2,
        played: 13,
        wins: 10,
        draws: 2,
        losses: 1,
        points: 32,
        scored: 36,
        conceded: 14,
        form: ["W", "W", "D", "W", "W"],
      },
      {
        id: "atletico",
        name: "Atlético de Madrid",
        shortName: "Atlético",
        color: "#CB3524",
        secondaryColor: "#FFFFFF",
        position: 3,
        played: 13,
        wins: 8,
        draws: 4,
        losses: 1,
        points: 28,
        scored: 25,
        conceded: 11,
        form: ["D", "W", "W", "D", "W"],
      },
      {
        id: "villarreal",
        name: "Villarreal CF",
        shortName: "Villarreal",
        color: "#FFE667",
        secondaryColor: "#005187",
        position: 4,
        played: 13,
        wins: 8,
        draws: 2,
        losses: 3,
        points: 26,
        scored: 28,
        conceded: 16,
        form: ["W", "L", "W", "W", "L"],
      },
      {
        id: "athletic",
        name: "Athletic Club",
        shortName: "Athletic",
        color: "#EE2523",
        secondaryColor: "#FFFFFF",
        position: 5,
        played: 13,
        wins: 6,
        draws: 4,
        losses: 3,
        points: 22,
        scored: 19,
        conceded: 13,
        form: ["W", "D", "D", "L", "W"],
      },
      {
        id: "betis",
        name: "Real Betis",
        shortName: "Betis",
        color: "#00954C",
        secondaryColor: "#FFFFFF",
        position: 6,
        played: 13,
        wins: 5,
        draws: 5,
        losses: 3,
        points: 20,
        scored: 18,
        conceded: 15,
        form: ["D", "D", "W", "D", "L"],
      },
    ],
    fixtures: [
      {
        homeId: "real-madrid",
        awayId: "barcelona",
        venue: "Santiago Bernabéu",
        startOffsetMinutes: 295,
        odds: { home: 2.15, draw: 3.65, away: 3.15 },
        injuries: {
          home: [
            {
              player: "Éder Militão",
              position: "Central",
              status: "Baja",
              reason: "Rotura de ligamento cruzado",
              impact: "medium",
            },
          ],
          away: [
            {
              player: "Gavi",
              position: "Mediocentro",
              status: "Baja",
              reason: "Lesión de menisco",
              impact: "high",
            },
            {
              player: "Ronald Araújo",
              position: "Central",
              status: "Duda",
              reason: "Molestias musculares",
              impact: "medium",
            },
          ],
        },
      },
    ],
  },
  {
    leagueId: "serie-a",
    teams: [
      {
        id: "inter",
        name: "Inter de Milán",
        shortName: "Inter",
        color: "#0068A8",
        secondaryColor: "#000000",
        position: 1,
        played: 13,
        wins: 10,
        draws: 2,
        losses: 1,
        points: 32,
        scored: 29,
        conceded: 11,
        form: ["W", "W", "W", "D", "W"],
      },
      {
        id: "napoli",
        name: "SSC Napoli",
        shortName: "Napoli",
        color: "#12A0D7",
        secondaryColor: "#FFFFFF",
        position: 2,
        played: 13,
        wins: 9,
        draws: 2,
        losses: 2,
        points: 29,
        scored: 22,
        conceded: 10,
        form: ["W", "W", "D", "W", "L"],
      },
      {
        id: "juventus",
        name: "Juventus",
        shortName: "Juventus",
        color: "#1A1A1A",
        secondaryColor: "#FFFFFF",
        position: 3,
        played: 13,
        wins: 7,
        draws: 5,
        losses: 1,
        points: 26,
        scored: 20,
        conceded: 9,
        form: ["D", "W", "D", "W", "W"],
      },
      {
        id: "atalanta",
        name: "Atalanta",
        shortName: "Atalanta",
        color: "#1E71B8",
        secondaryColor: "#000000",
        position: 4,
        played: 13,
        wins: 7,
        draws: 3,
        losses: 3,
        points: 24,
        scored: 27,
        conceded: 17,
        form: ["W", "L", "W", "W", "D"],
      },
      {
        id: "milan",
        name: "AC Milan",
        shortName: "Milan",
        color: "#FB090B",
        secondaryColor: "#000000",
        position: 5,
        played: 13,
        wins: 6,
        draws: 4,
        losses: 3,
        points: 22,
        scored: 21,
        conceded: 15,
        form: ["D", "W", "L", "W", "D"],
      },
      {
        id: "roma",
        name: "AS Roma",
        shortName: "Roma",
        color: "#8E1F2F",
        secondaryColor: "#F0BC42",
        position: 6,
        played: 13,
        wins: 5,
        draws: 5,
        losses: 3,
        points: 20,
        scored: 17,
        conceded: 13,
        form: ["W", "D", "D", "L", "W"],
      },
    ],
    fixtures: [
      {
        homeId: "inter",
        awayId: "juventus",
        venue: "San Siro",
        startOffsetMinutes: 355,
        odds: { home: 2.01, draw: 3.3, away: 3.95 },
        injuries: {
          home: [
            {
              player: "Benjamin Pavard",
              position: "Defensa",
              status: "Duda",
              reason: "Esguince de tobillo",
              impact: "medium",
            },
          ],
          away: [
            {
              player: "Arkadiusz Milik",
              position: "Delantero",
              status: "Baja",
              reason: "Recaída muscular",
              impact: "low",
            },
          ],
        },
      },
    ],
  },
  {
    leagueId: "bundesliga",
    teams: [
      {
        id: "bayern",
        name: "Bayern Múnich",
        shortName: "Bayern",
        color: "#DC052D",
        secondaryColor: "#0066B2",
        position: 1,
        played: 11,
        wins: 10,
        draws: 1,
        losses: 0,
        points: 31,
        scored: 38,
        conceded: 9,
        form: ["W", "W", "W", "W", "W"],
      },
      {
        id: "leverkusen",
        name: "Bayer Leverkusen",
        shortName: "Leverkusen",
        color: "#E32221",
        secondaryColor: "#000000",
        position: 2,
        played: 11,
        wins: 8,
        draws: 2,
        losses: 1,
        points: 26,
        scored: 28,
        conceded: 13,
        form: ["W", "D", "W", "W", "W"],
      },
      {
        id: "leipzig",
        name: "RB Leipzig",
        shortName: "Leipzig",
        color: "#DD0741",
        secondaryColor: "#FFFFFF",
        position: 3,
        played: 11,
        wins: 7,
        draws: 2,
        losses: 2,
        points: 23,
        scored: 21,
        conceded: 12,
        form: ["L", "W", "W", "D", "W"],
      },
      {
        id: "dortmund",
        name: "Borussia Dortmund",
        shortName: "Dortmund",
        color: "#FDE100",
        secondaryColor: "#000000",
        position: 4,
        played: 11,
        wins: 6,
        draws: 3,
        losses: 2,
        points: 21,
        scored: 24,
        conceded: 16,
        form: ["W", "D", "L", "W", "W"],
      },
      {
        id: "frankfurt",
        name: "Eintracht Frankfurt",
        shortName: "Frankfurt",
        color: "#E1000F",
        secondaryColor: "#000000",
        position: 5,
        played: 11,
        wins: 5,
        draws: 4,
        losses: 2,
        points: 19,
        scored: 22,
        conceded: 18,
        form: ["D", "W", "D", "L", "W"],
      },
      {
        id: "stuttgart",
        name: "VfB Stuttgart",
        shortName: "Stuttgart",
        color: "#E32219",
        secondaryColor: "#FFFFFF",
        position: 6,
        played: 11,
        wins: 5,
        draws: 2,
        losses: 4,
        points: 17,
        scored: 19,
        conceded: 17,
        form: ["W", "L", "W", "L", "D"],
      },
    ],
    fixtures: [
      {
        homeId: "bayern",
        awayId: "dortmund",
        venue: "Allianz Arena",
        startOffsetMinutes: 415,
        odds: { home: 1.88, draw: 3.9, away: 3.95 },
        injuries: {
          home: [
            {
              player: "Jamal Musiala",
              position: "Mediapunta",
              status: "Duda",
              reason: "Sobrecarga muscular",
              impact: "medium",
            },
          ],
          away: [
            {
              player: "Karim Adeyemi",
              position: "Extremo",
              status: "Baja",
              reason: "Lesión de tobillo",
              impact: "low",
            },
          ],
        },
      },
    ],
  },
  {
    leagueId: "champions",
    teams: [
      {
        id: "man-city-ucl",
        name: "Manchester City",
        shortName: "Man City",
        color: "#6CABDD",
        secondaryColor: "#1C2C5B",
        position: 1,
        played: 5,
        wins: 4,
        draws: 1,
        losses: 0,
        points: 13,
        scored: 12,
        conceded: 4,
        form: ["W", "W", "D", "W", "W"],
      },
      {
        id: "inter-ucl",
        name: "Inter de Milán",
        shortName: "Inter",
        color: "#0068A8",
        secondaryColor: "#000000",
        position: 2,
        played: 5,
        wins: 4,
        draws: 0,
        losses: 1,
        points: 12,
        scored: 10,
        conceded: 3,
        form: ["W", "W", "W", "L", "W"],
      },
      {
        id: "psg",
        name: "Paris Saint-Germain",
        shortName: "PSG",
        color: "#004170",
        secondaryColor: "#DA291C",
        position: 3,
        played: 5,
        wins: 3,
        draws: 1,
        losses: 1,
        points: 10,
        scored: 11,
        conceded: 7,
        form: ["D", "W", "W", "W", "L"],
      },
      {
        id: "arsenal-ucl",
        name: "Arsenal",
        shortName: "Arsenal",
        color: "#EF0107",
        secondaryColor: "#FFFFFF",
        position: 4,
        played: 5,
        wins: 3,
        draws: 1,
        losses: 1,
        points: 10,
        scored: 9,
        conceded: 4,
        form: ["W", "D", "W", "W", "W"],
      },
      {
        id: "bayern-ucl",
        name: "Bayern Múnich",
        shortName: "Bayern",
        color: "#DC052D",
        secondaryColor: "#0066B2",
        position: 5,
        played: 5,
        wins: 3,
        draws: 0,
        losses: 2,
        points: 9,
        scored: 13,
        conceded: 8,
        form: ["W", "L", "W", "W", "L"],
      },
      {
        id: "real-madrid-ucl",
        name: "Real Madrid",
        shortName: "Real Madrid",
        color: "#FEBE10",
        secondaryColor: "#1E3A8A",
        position: 6,
        played: 5,
        wins: 3,
        draws: 0,
        losses: 2,
        points: 9,
        scored: 10,
        conceded: 7,
        form: ["L", "W", "W", "L", "W"],
      },
      {
        id: "liverpool-ucl",
        name: "Liverpool",
        shortName: "Liverpool",
        color: "#C8102E",
        secondaryColor: "#00B2A9",
        position: 7,
        played: 5,
        wins: 2,
        draws: 1,
        losses: 2,
        points: 7,
        scored: 7,
        conceded: 7,
        form: ["D", "L", "W", "D", "W"],
      },
      {
        id: "barcelona-ucl",
        name: "FC Barcelona",
        shortName: "Barcelona",
        color: "#A50044",
        secondaryColor: "#004D98",
        position: 8,
        played: 5,
        wins: 2,
        draws: 0,
        losses: 3,
        points: 6,
        scored: 9,
        conceded: 11,
        form: ["L", "W", "L", "W", "L"],
      },
    ],
    fixtures: [
      {
        homeId: "psg",
        awayId: "man-city-ucl",
        venue: "Parc des Princes",
        startOffsetMinutes: 475,
        odds: { home: 2.55, draw: 3.55, away: 2.65 },
        injuries: {
          home: [
            {
              player: "Ousmane Dembélé",
              position: "Extremo",
              status: "Duda",
              reason: "Molestia en el muslo",
              impact: "medium",
            },
          ],
          away: [
            {
              player: "Nathan Aké",
              position: "Defensa",
              status: "Baja",
              reason: "Lesión en el pie",
              impact: "low",
            },
          ],
        },
      },
    ],
  },
  {
    leagueId: "nba",
    teams: [
      {
        id: "celtics",
        name: "Boston Celtics",
        shortName: "Celtics",
        color: "#007A33",
        secondaryColor: "#BA9653",
        position: 1,
        group: "Este",
        played: 18,
        wins: 15,
        losses: 3,
        points: 30,
        scored: 2090,
        conceded: 1950,
        form: ["W", "W", "W", "L", "W"],
      },
      {
        id: "bucks",
        name: "Milwaukee Bucks",
        shortName: "Bucks",
        color: "#00471B",
        secondaryColor: "#EEE1C6",
        position: 2,
        group: "Este",
        played: 17,
        wins: 11,
        losses: 6,
        points: 22,
        scored: 1950,
        conceded: 1900,
        form: ["W", "L", "W", "W", "L"],
      },
      {
        id: "knicks",
        name: "New York Knicks",
        shortName: "Knicks",
        color: "#F58426",
        secondaryColor: "#006BB6",
        position: 3,
        group: "Este",
        played: 18,
        wins: 12,
        losses: 6,
        points: 24,
        scored: 2034,
        conceded: 1980,
        form: ["W", "L", "W", "W", "L"],
      },
      {
        id: "cavs",
        name: "Cleveland Cavaliers",
        shortName: "Cavaliers",
        color: "#860038",
        secondaryColor: "#FDBB30",
        position: 4,
        group: "Este",
        played: 18,
        wins: 10,
        losses: 8,
        points: 20,
        scored: 2016,
        conceded: 1980,
        form: ["L", "W", "W", "L", "W"],
      },
      {
        id: "thunder",
        name: "Oklahoma City Thunder",
        shortName: "Thunder",
        color: "#007AC1",
        secondaryColor: "#EF3B24",
        position: 1,
        group: "Oeste",
        played: 18,
        wins: 15,
        losses: 3,
        points: 30,
        scored: 2110,
        conceded: 1920,
        form: ["W", "W", "W", "W", "L"],
      },
      {
        id: "nuggets",
        name: "Denver Nuggets",
        shortName: "Nuggets",
        color: "#0E2240",
        secondaryColor: "#FEC524",
        position: 2,
        group: "Oeste",
        played: 18,
        wins: 12,
        losses: 6,
        points: 24,
        scored: 2100,
        conceded: 2020,
        form: ["W", "W", "L", "W", "W"],
      },
      {
        id: "lakers",
        name: "Los Angeles Lakers",
        shortName: "Lakers",
        color: "#552583",
        secondaryColor: "#FDB927",
        position: 4,
        group: "Oeste",
        played: 18,
        wins: 11,
        losses: 7,
        points: 22,
        scored: 2060,
        conceded: 2040,
        form: ["W", "W", "L", "W", "L"],
      },
      {
        id: "warriors",
        name: "Golden State Warriors",
        shortName: "Warriors",
        color: "#1D428A",
        secondaryColor: "#FFC72C",
        position: 6,
        group: "Oeste",
        played: 18,
        wins: 9,
        losses: 9,
        points: 18,
        scored: 2050,
        conceded: 2088,
        form: ["L", "W", "L", "W", "L"],
      },
    ],
    fixtures: [
      {
        homeId: "celtics",
        awayId: "knicks",
        venue: "TD Garden",
        startOffsetMinutes: 145,
        odds: { home: 1.92, away: 2.02 },
        injuries: {
          home: [
            {
              player: "Kristaps Porziņģis",
              position: "Pívot",
              status: "Duda",
              reason: "Gestión de carga",
              impact: "medium",
            },
          ],
          away: [
            {
              player: "Mitchell Robinson",
              position: "Pívot",
              status: "Baja",
              reason: "Cirugía de tobillo",
              impact: "high",
            },
          ],
        },
      },
      {
        homeId: "lakers",
        awayId: "warriors",
        venue: "Crypto.com Arena",
        startOffsetMinutes: 205,
        odds: { home: 2.05, away: 1.92 },
        injuries: {
          home: [
            {
              player: "Jarred Vanderbilt",
              position: "Ala-pívot",
              status: "Baja",
              reason: "Lesión de rodilla",
              impact: "medium",
            },
          ],
          away: [
            {
              player: "Draymond Green",
              position: "Ala-pívot",
              status: "Duda",
              reason: "Molestia lumbar",
              impact: "medium",
            },
          ],
        },
      },
    ],
  },
  {
    leagueId: "euroleague",
    teams: [
      {
        id: "real-madrid-basket",
        name: "Real Madrid Baloncesto",
        shortName: "Real Madrid",
        color: "#FEBE10",
        secondaryColor: "#1E3A8A",
        position: 1,
        played: 12,
        wins: 10,
        losses: 2,
        points: 20,
        scored: 1044,
        conceded: 972,
        form: ["W", "W", "W", "W", "L"],
      },
      {
        id: "panathinaikos",
        name: "Panathinaikos BC",
        shortName: "Panathinaikos",
        color: "#007A33",
        secondaryColor: "#FFFFFF",
        position: 2,
        played: 12,
        wins: 9,
        losses: 3,
        points: 18,
        scored: 1020,
        conceded: 990,
        form: ["W", "W", "L", "W", "W"],
      },
      {
        id: "olympiacos",
        name: "Olympiacos",
        shortName: "Olympiacos",
        color: "#D71920",
        secondaryColor: "#FFFFFF",
        position: 3,
        played: 12,
        wins: 9,
        losses: 3,
        points: 18,
        scored: 1008,
        conceded: 984,
        form: ["W", "L", "W", "W", "W"],
      },
      {
        id: "fenerbahce",
        name: "Fenerbahçe",
        shortName: "Fenerbahçe",
        color: "#FFED00",
        secondaryColor: "#00205B",
        position: 4,
        played: 12,
        wins: 8,
        losses: 4,
        points: 16,
        scored: 996,
        conceded: 978,
        form: ["L", "W", "W", "L", "W"],
      },
      {
        id: "barcelona-basket",
        name: "Barça Basket",
        shortName: "Barça",
        color: "#A50044",
        secondaryColor: "#004D98",
        position: 5,
        played: 12,
        wins: 7,
        losses: 5,
        points: 14,
        scored: 984,
        conceded: 972,
        form: ["W", "L", "W", "L", "W"],
      },
      {
        id: "monaco",
        name: "AS Mónaco Basket",
        shortName: "Mónaco",
        color: "#E2001A",
        secondaryColor: "#FFFFFF",
        position: 6,
        played: 12,
        wins: 7,
        losses: 5,
        points: 14,
        scored: 1014,
        conceded: 1002,
        form: ["L", "W", "L", "W", "W"],
      },
    ],
    fixtures: [
      {
        homeId: "real-madrid-basket",
        awayId: "panathinaikos",
        venue: "Movistar Arena",
        startOffsetMinutes: 265,
        odds: { home: 1.9, away: 2.0 },
        injuries: {
          home: [
            {
              player: "Facundo Campazzo",
              position: "Base",
              status: "Duda",
              reason: "Esguince de tobillo",
              impact: "medium",
            },
          ],
          away: [
            {
              player: "Mathias Lessort",
              position: "Pívot",
              status: "Baja",
              reason: "Fractura de peroné",
              impact: "high",
            },
          ],
        },
      },
    ],
  },
  {
    leagueId: "mlb",
    teams: [
      {
        id: "yankees",
        name: "New York Yankees",
        shortName: "Yankees",
        color: "#132448",
        secondaryColor: "#C4CED4",
        position: 1,
        group: "AL Este",
        played: 162,
        wins: 96,
        losses: 66,
        points: 192,
        scored: 850,
        conceded: 700,
        form: ["W", "W", "L", "W", "W"],
      },
      {
        id: "orioles",
        name: "Baltimore Orioles",
        shortName: "Orioles",
        color: "#DF4601",
        secondaryColor: "#000000",
        position: 2,
        group: "AL Este",
        played: 162,
        wins: 91,
        losses: 71,
        points: 182,
        scored: 802,
        conceded: 750,
        form: ["L", "W", "W", "L", "W"],
      },
      {
        id: "red-sox",
        name: "Boston Red Sox",
        shortName: "Red Sox",
        color: "#BD3039",
        secondaryColor: "#0C2340",
        position: 3,
        group: "AL Este",
        played: 162,
        wins: 86,
        losses: 76,
        points: 172,
        scored: 790,
        conceded: 778,
        form: ["W", "L", "W", "W", "L"],
      },
      {
        id: "astros",
        name: "Houston Astros",
        shortName: "Astros",
        color: "#EB6E1F",
        secondaryColor: "#002D62",
        position: 1,
        group: "AL Oeste",
        played: 162,
        wins: 88,
        losses: 74,
        points: 176,
        scored: 776,
        conceded: 742,
        form: ["W", "W", "L", "W", "L"],
      },
      {
        id: "dodgers",
        name: "Los Angeles Dodgers",
        shortName: "Dodgers",
        color: "#005A9C",
        secondaryColor: "#EF3E42",
        position: 1,
        group: "NL Oeste",
        played: 162,
        wins: 100,
        losses: 62,
        points: 200,
        scored: 884,
        conceded: 698,
        form: ["W", "W", "W", "W", "L"],
      },
      {
        id: "padres",
        name: "San Diego Padres",
        shortName: "Padres",
        color: "#2F241D",
        secondaryColor: "#FFC425",
        position: 2,
        group: "NL Oeste",
        played: 162,
        wins: 90,
        losses: 72,
        points: 180,
        scored: 796,
        conceded: 730,
        form: ["W", "L", "W", "L", "W"],
      },
      {
        id: "braves",
        name: "Atlanta Braves",
        shortName: "Braves",
        color: "#CE1141",
        secondaryColor: "#13274F",
        position: 1,
        group: "NL Este",
        played: 162,
        wins: 89,
        losses: 73,
        points: 178,
        scored: 812,
        conceded: 756,
        form: ["W", "W", "L", "L", "W"],
      },
      {
        id: "mets",
        name: "New York Mets",
        shortName: "Mets",
        color: "#002D72",
        secondaryColor: "#FF5910",
        position: 2,
        group: "NL Este",
        played: 162,
        wins: 84,
        losses: 78,
        points: 168,
        scored: 768,
        conceded: 754,
        form: ["L", "W", "L", "W", "W"],
      },
    ],
    fixtures: [
      {
        homeId: "yankees",
        awayId: "red-sox",
        venue: "Yankee Stadium",
        startOffsetMinutes: 195,
        odds: { home: 1.94, away: 1.94 },
        injuries: {
          home: [
            {
              player: "Gerrit Cole",
              position: "Abridor",
              status: "Baja",
              reason: "Inflamación en el codo",
              impact: "high",
            },
          ],
          away: [
            {
              player: "Trevor Story",
              position: "Campocorto",
              status: "Duda",
              reason: "Molestia en el hombro",
              impact: "medium",
            },
          ],
        },
      },
      {
        homeId: "dodgers",
        awayId: "padres",
        venue: "Dodger Stadium",
        startOffsetMinutes: 255,
        odds: { home: 1.8, away: 2.18 },
        injuries: {
          home: [
            {
              player: "Shohei Ohtani",
              position: "Bateador designado",
              status: "Duda",
              reason: "Gestión de carga",
              impact: "low",
            },
          ],
          away: [
            {
              player: "Yu Darvish",
              position: "Abridor",
              status: "Baja",
              reason: "Lesión en el codo",
              impact: "high",
            },
          ],
        },
      },
    ],
  },
  {
    leagueId: "lidom",
    teams: [
      {
        id: "licey",
        name: "Tigres del Licey",
        shortName: "Licey",
        color: "#003DA5",
        secondaryColor: "#FFD100",
        position: 1,
        played: 24,
        wins: 16,
        losses: 8,
        points: 32,
        scored: 118,
        conceded: 92,
        form: ["W", "W", "L", "W", "W"],
      },
      {
        id: "aguilas",
        name: "Águilas Cibaeñas",
        shortName: "Águilas",
        color: "#FDB927",
        secondaryColor: "#C8102E",
        position: 2,
        played: 24,
        wins: 15,
        losses: 9,
        points: 30,
        scored: 112,
        conceded: 98,
        form: ["W", "L", "W", "W", "L"],
      },
      {
        id: "leones",
        name: "Leones del Escogido",
        shortName: "Leones",
        color: "#C8102E",
        secondaryColor: "#FFFFFF",
        position: 3,
        played: 24,
        wins: 14,
        losses: 10,
        points: 28,
        scored: 106,
        conceded: 96,
        form: ["L", "W", "W", "L", "W"],
      },
      {
        id: "toros",
        name: "Toros del Este",
        shortName: "Toros",
        color: "#D50032",
        secondaryColor: "#000000",
        position: 4,
        played: 24,
        wins: 12,
        losses: 12,
        points: 24,
        scored: 101,
        conceded: 103,
        form: ["W", "L", "L", "W", "L"],
      },
      {
        id: "estrellas",
        name: "Estrellas Orientales",
        shortName: "Estrellas",
        color: "#007A33",
        secondaryColor: "#FFD100",
        position: 5,
        played: 24,
        wins: 11,
        losses: 13,
        points: 22,
        scored: 96,
        conceded: 108,
        form: ["L", "W", "L", "L", "W"],
      },
      {
        id: "gigantes",
        name: "Gigantes del Cibao",
        shortName: "Gigantes",
        color: "#6F2C91",
        secondaryColor: "#FFD100",
        position: 6,
        played: 24,
        wins: 10,
        losses: 14,
        points: 20,
        scored: 91,
        conceded: 110,
        form: ["L", "L", "W", "L", "W"],
      },
    ],
    fixtures: [
      {
        homeId: "licey",
        awayId: "aguilas",
        venue: "Estadio Quisqueya",
        startOffsetMinutes: 325,
        odds: { home: 1.95, away: 1.92 },
        injuries: {
          home: [
            {
              player: "Emilio Bonifácio",
              position: "Utility",
              status: "Duda",
              reason: "Molestia en la muñeca",
              impact: "low",
            },
          ],
          away: [
            {
              player: "Juan Lagares",
              position: "Jardinero central",
              status: "Baja",
              reason: "Lesión en el oblicuo",
              impact: "medium",
            },
          ],
        },
      },
    ],
  },
  {
    leagueId: "nhl",
    teams: [
      {
        id: "bruins",
        name: "Boston Bruins",
        shortName: "Bruins",
        color: "#FFB81C",
        secondaryColor: "#000000",
        position: 1,
        group: "Atlántico",
        played: 20,
        wins: 14,
        draws: 2,
        losses: 4,
        points: 30,
        scored: 68,
        conceded: 49,
        form: ["W", "W", "W", "L", "W"],
      },
      {
        id: "rangers",
        name: "New York Rangers",
        shortName: "Rangers",
        color: "#0038A8",
        secondaryColor: "#CE1126",
        position: 2,
        group: "Metropolitana",
        played: 20,
        wins: 13,
        draws: 2,
        losses: 5,
        points: 28,
        scored: 63,
        conceded: 51,
        form: ["W", "L", "W", "W", "D"],
      },
      {
        id: "maple-leafs",
        name: "Toronto Maple Leafs",
        shortName: "Maple Leafs",
        color: "#003E7E",
        secondaryColor: "#FFFFFF",
        position: 2,
        group: "Atlántico",
        played: 20,
        wins: 13,
        draws: 2,
        losses: 5,
        points: 28,
        scored: 66,
        conceded: 51,
        form: ["W", "W", "W", "W", "L"],
      },
      {
        id: "canadiens",
        name: "Montreal Canadiens",
        shortName: "Canadiens",
        color: "#AF1E2D",
        secondaryColor: "#FFFFFF",
        position: 5,
        group: "Atlántico",
        played: 20,
        wins: 9,
        draws: 3,
        losses: 8,
        points: 21,
        scored: 52,
        conceded: 58,
        form: ["L", "W", "L", "D", "W"],
      },
      {
        id: "panthers",
        name: "Florida Panthers",
        shortName: "Panthers",
        color: "#C8102E",
        secondaryColor: "#041E42",
        position: 3,
        group: "Atlántico",
        played: 20,
        wins: 11,
        draws: 2,
        losses: 7,
        points: 24,
        scored: 57,
        conceded: 54,
        form: ["W", "L", "W", "L", "W"],
      },
      {
        id: "devils",
        name: "New Jersey Devils",
        shortName: "Devils",
        color: "#CE1126",
        secondaryColor: "#000000",
        position: 4,
        group: "Metropolitana",
        played: 20,
        wins: 10,
        draws: 3,
        losses: 7,
        points: 23,
        scored: 55,
        conceded: 53,
        form: ["L", "W", "D", "W", "L"],
      },
    ],
    fixtures: [
      {
        homeId: "rangers",
        awayId: "bruins",
        venue: "Madison Square Garden",
        startOffsetMinutes: 225,
        odds: { home: 2.02, away: 1.9 },
        injuries: {
          home: [
            {
              player: "Filip Chytil",
              position: "Centro",
              status: "Duda",
              reason: "Protocolo de conmoción",
              impact: "medium",
            },
          ],
          away: [
            {
              player: "Charlie McAvoy",
              position: "Defensa",
              status: "Baja",
              reason: "Lesión de hombro",
              impact: "high",
            },
          ],
        },
      },
      {
        homeId: "maple-leafs",
        awayId: "canadiens",
        venue: "Scotiabank Arena",
        startOffsetMinutes: 285,
        odds: { home: 1.8, away: 2.12 },
        injuries: {
          home: [
            {
              player: "Auston Matthews",
              position: "Centro",
              status: "Duda",
              reason: "Molestia en la muñeca",
              impact: "high",
            },
          ],
          away: [
            {
              player: "Kirby Dach",
              position: "Centro",
              status: "Baja",
              reason: "Lesión de rodilla",
              impact: "low",
            },
          ],
        },
      },
    ],
  },
];

function buildTeam(seed: TeamSeed): TeamRef {
  return {
    id: seed.id,
    name: seed.name,
    shortName: seed.shortName,
    color: seed.color,
    secondaryColor: seed.secondaryColor,
  };
}

function buildStanding(seed: TeamSeed, sport: SportKey): StandingRow {
  const draws = seed.draws ?? 0;
  const points = seed.points ?? seed.wins * 2;
  return {
    teamId: seed.id,
    teamName: seed.name,
    teamShortName: seed.shortName,
    position: seed.position,
    played: seed.played,
    wins: seed.wins,
    draws,
    losses: seed.losses,
    points,
    winPercentage: seed.played > 0 ? seed.wins / seed.played : 0,
    scored: seed.scored,
    conceded: seed.conceded,
    difference: seed.scored - seed.conceded,
    form: [...seed.form],
    group: seed.group,
    note: sport === "soccer" ? "Temporada regular" : undefined,
  };
}

function buildVenueSplits(seed: TeamSeed): { home: VenueSplit; away: VenueSplit } {
  const draws = seed.draws ?? 0;
  const homePlayed = Math.ceil(seed.played / 2);
  const awayPlayed = seed.played - homePlayed;
  const homeWins = Math.min(homePlayed, Math.round(seed.wins * 0.58));
  const homeDraws = Math.min(
    draws,
    homePlayed - homeWins,
    Math.round(draws * 0.55),
  );
  const awayWins = Math.max(0, seed.wins - homeWins);
  const awayDraws = Math.max(0, draws - homeDraws);
  const homeLosses = Math.max(0, homePlayed - homeWins - homeDraws);
  const awayLosses = Math.max(0, awayPlayed - awayWins - awayDraws);
  const homeShare = 0.535;

  return {
    home: {
      played: homePlayed,
      wins: Math.max(0, homeWins),
      draws: Math.max(0, homeDraws),
      losses: homeLosses,
      scored: Math.round(seed.scored * homeShare * 10) / 10,
      conceded: Math.round(seed.conceded * 0.47 * 10) / 10,
    },
    away: {
      played: awayPlayed,
      wins: awayWins,
      draws: awayDraws,
      losses: awayLosses,
      scored: Math.round(seed.scored * (1 - homeShare) * 10) / 10,
      conceded: Math.round(seed.conceded * 0.53 * 10) / 10,
    },
  };
}

function calculateStreak(form: FormResult[]): string {
  if (form.length === 0) return "Sin datos";
  const latest = form[form.length - 1];
  let count = 0;
  for (let index = form.length - 1; index >= 0; index -= 1) {
    if (form[index] !== latest) break;
    count += 1;
  }
  const label =
    latest === "W" ? "victoria" : latest === "D" ? "empate" : "derrota";
  return `${count} ${label}${count === 1 ? "" : latest === "W" ? "s" : "s"}`;
}

function buildStats(seed: TeamSeed): TeamAdvancedStats {
  const splits = buildVenueSplits(seed);
  return {
    teamId: seed.id,
    form: [...seed.form],
    avgScored:
      seed.played > 0
        ? Math.round((seed.scored / seed.played) * 10) / 10
        : 0,
    avgConceded:
      seed.played > 0
        ? Math.round((seed.conceded / seed.played) * 10) / 10
        : 0,
    home: splits.home,
    away: splits.away,
    streak: calculateStreak(seed.form),
  };
}

function buildInjuries(
  seeds: InjurySeed[] | undefined,
  teamId: string,
  fixtureId: string,
): Injury[] {
  return (seeds ?? []).map((seed, index) => ({
    id: `${fixtureId}-${teamId}-${index}`,
    teamId,
    player: seed.player,
    position: seed.position,
    status: seed.status,
    reason: seed.reason,
    impact: seed.impact,
  }));
}

function buildBookmakers(
  fixture: FixtureSeed,
  updatedAt: string,
): BookmakerQuote[] {
  return BOOKMAKER_TEMPLATES.map((template) => {
    const draw =
      fixture.odds.draw === undefined
        ? null
        : Math.round(
            clamp(fixture.odds.draw + template.drawDelta, 1.05, 50) * 100,
          ) / 100;
    return {
      id: `${template.id}-${template.source}`,
      name: template.name,
      source: template.source,
      updatedAt,
      outcomes: {
        home:
          Math.round(
            clamp(fixture.odds.home + template.homeDelta, 1.05, 50) * 100,
          ) / 100,
        draw,
        away:
          Math.round(
            clamp(fixture.odds.away + template.awayDelta, 1.05, 50) * 100,
          ) / 100,
      },
    };
  });
}

function buildMockMatch(
  league: LeagueInfo,
  fixture: FixtureSeed,
  teamsById: Map<string, TeamSeed>,
  standings: StandingRow[],
  statsByTeam: Map<string, TeamAdvancedStats>,
  index: number,
): SportsMatch {
  const homeSeed = teamsById.get(fixture.homeId);
  const awaySeed = teamsById.get(fixture.awayId);

  if (!homeSeed || !awaySeed) {
    throw new Error(`Equipo mock no encontrado para ${league.name}`);
  }

  const home = buildTeam(homeSeed);
  const away = buildTeam(awaySeed);
  const fixtureId = `mock-${league.id}-${homeSeed.id}-${awaySeed.id}`;
  const commenceTime = new Date(
    Date.now() + fixture.startOffsetMinutes * 60 * 1000,
  ).toISOString();
  const updatedAt = new Date(Date.now() - (5 + index) * 60 * 1000).toISOString();
  const homeStanding =
    standings.find((row) => row.teamId === homeSeed.id) ??
    buildStanding(homeSeed, league.sport);
  const awayStanding =
    standings.find((row) => row.teamId === awaySeed.id) ??
    buildStanding(awaySeed, league.sport);
  const homeStats =
    statsByTeam.get(homeSeed.id) ?? buildStats(homeSeed);
  const awayStats =
    statsByTeam.get(awaySeed.id) ?? buildStats(awaySeed);
  const injuries = {
    home: buildInjuries(fixture.injuries?.home, home.id, fixtureId),
    away: buildInjuries(fixture.injuries?.away, away.id, fixtureId),
  };
  const bookmakers = buildBookmakers(fixture, updatedAt);
  const intel: MatchIntel = {
    standings: {
      home: homeStanding,
      away: awayStanding,
      table: standings,
    },
    stats: {
      home: homeStats,
      away: awayStats,
    },
    injuries,
    note:
      league.sport === "baseball"
        ? "Los equipos abridores pueden confirmarse hasta 90 minutos antes del primer lanzamiento."
        : league.sport === "basketball"
          ? "El estado de los jugadores es orientativo y puede cambiar hasta el salto inicial."
          : undefined,
  };

  return {
    id: fixtureId,
    sport: league.sport,
    league,
    commenceTime,
    status: "scheduled",
    venue: fixture.venue,
    home,
    away,
    odds: summarizeMarket(bookmakers),
    intel,
  };
}

function buildMockDashboard(): DashboardData {
  const matches: SportsMatch[] = [];
  let index = 0;

  for (const leagueSeed of MOCK_LEAGUES) {
    const league = LEAGUES.find((item) => item.id === leagueSeed.leagueId);
    if (!league) continue;

    const teamsById = new Map(
      leagueSeed.teams.map((team) => [team.id, team] as const),
    );
    const standings = leagueSeed.teams
      .map((team) => buildStanding(team, league.sport))
      .sort((a, b) => {
        const groupCompare = (a.group ?? "").localeCompare(b.group ?? "");
        return groupCompare !== 0 ? groupCompare : a.position - b.position;
      });
    const statsByTeam = new Map(
      leagueSeed.teams.map((team) => [team.id, buildStats(team)] as const),
    );

    for (const fixture of leagueSeed.fixtures) {
      matches.push(
        buildMockMatch(
          league,
          fixture,
          teamsById,
          standings,
          statsByTeam,
          index,
        ),
      );
      index += 1;
    }
  }

  matches.sort(
    (a, b) =>
      new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime(),
  );

  const activeLeagueIds = new Set(matches.map((match) => match.league.id));
  const sportCounts: Record<SportKey, number> = {
    soccer: 0,
    basketball: 0,
    baseball: 0,
    hockey: 0,
  };
  for (const match of matches) {
    sportCounts[match.sport] += 1;
  }

  return {
    matches,
    leagues: LEAGUES.filter((league) => activeLeagueIds.has(league.id)),
    sportCounts,
    meta: {
      mode: "mock",
      generatedAt: new Date().toISOString(),
      cacheTtlSeconds: 3600,
      oddsCreditsRemaining: null,
      sportmonksRemaining: null,
      apiSportsRemaining: null,
      warnings: [
        "Modo demo activo: configura THE_ODDS_API_KEY, SPORTMONKS_KEY y APISPORTS_KEY en .env.local para consultar cuotas y estadísticas reales.",
        "Los datos mostrados son simulados y no representan eventos ni cuotas reales.",
      ],
      sources: {
        oddsApi: false,
        sportmonks: false,
        apiSports: false,
      },
    },
  };
}

let cachedMock: DashboardData | null = null;

export function getMockDashboardData(): DashboardData {
  const hourBucket = new Date().toISOString().slice(0, 13);
  if (!cachedMock || cachedMock.meta.generatedAt.slice(0, 13) !== hourBucket) {
    cachedMock = buildMockDashboard();
  }
  return cachedMock;
}

export function getMockMatchesForLeague(leagueId: string): SportsMatch[] {
  return getMockDashboardData().matches.filter(
    (match) => match.league.id === leagueId,
  );
}

export function getMockTeamInitials(name: string): string {
  return initials(name);
}
