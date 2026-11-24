import artifactJson from "@/data/model-params.json";
import { DEFAULT_DIXON_COLES_PARAMS, type DixonColesModel } from "@/lib/dixonColes";
import { DEFAULT_ELO_CONFIG, type EloConfig, type EloSnapshot } from "@/services/ratingService";

export interface ModelArtifact {
  generatedAt: string;
  dixonColes: DixonColesModel;
  elo: Record<string, EloSnapshot>;
  eloConfig: EloConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeStrengthMap(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (!isRecord(value)) return result;

  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) continue;
    result[key] = clamp(raw, 0.05, 20);
  }
  return result;
}

function normalizeDixonColes(value: unknown): DixonColesModel {
  const source = isRecord(value) ? value : {};
  const paramsSource = isRecord(source.params) ? source.params : {};

  return {
    params: {
      rho: clamp(finiteNumber(paramsSource.rho, DEFAULT_DIXON_COLES_PARAMS.rho), -0.5, 0.5),
      xiPerDay: clamp(
        finiteNumber(paramsSource.xiPerDay, DEFAULT_DIXON_COLES_PARAMS.xiPerDay),
        0,
        0.05,
      ),
      homeAdvantage: clamp(
        finiteNumber(paramsSource.homeAdvantage, DEFAULT_DIXON_COLES_PARAMS.homeAdvantage),
        -0.5,
        2,
      ),
    },
    leagueAverage: clamp(finiteNumber(source.leagueAverage, 1.4), 0.05, 10),
    attack: normalizeStrengthMap(source.attack),
    defense: normalizeStrengthMap(source.defense),
  };
}

function normalizeEloSnapshot(value: unknown): EloSnapshot | null {
  if (!isRecord(value)) return null;
  const rating = finiteNumber(value.rating, NaN);
  const n = finiteNumber(value.n, NaN);
  const lastMatchAt = typeof value.lastMatchAt === "string" ? value.lastMatchAt : "";
  if (!Number.isFinite(rating) || !Number.isFinite(n) || !Number.isFinite(Date.parse(lastMatchAt))) {
    return null;
  }

  const snapshot: EloSnapshot = {
    rating,
    n: Math.max(0, Math.floor(n)),
    lastMatchAt,
  };
  if (typeof value.leagueId === "string" && value.leagueId.length > 0) {
    snapshot.leagueId = value.leagueId;
  }
  return snapshot;
}

function normalizeElo(value: unknown): Record<string, EloSnapshot> {
  const result: Record<string, EloSnapshot> = {};
  if (!isRecord(value)) return result;

  for (const [team, raw] of Object.entries(value)) {
    const snapshot = normalizeEloSnapshot(raw);
    if (snapshot) result[team] = snapshot;
  }
  return result;
}

function normalizeEloConfig(value: unknown): EloConfig {
  const source = isRecord(value) ? value : {};
  return {
    k: clamp(finiteNumber(source.k, DEFAULT_ELO_CONFIG.k), 0, 200),
    homeAdvantage: clamp(
      finiteNumber(source.homeAdvantage, DEFAULT_ELO_CONFIG.homeAdvantage),
      -500,
      500,
    ),
    decayPerDay: clamp(finiteNumber(source.decayPerDay, DEFAULT_ELO_CONFIG.decayPerDay), 0, 1),
    initialRating: clamp(
      finiteNumber(source.initialRating, DEFAULT_ELO_CONFIG.initialRating),
      0,
      5000,
    ),
  };
}

function normalizeArtifact(value: unknown): ModelArtifact {
  const source = isRecord(value) ? value : {};
  const generatedAtRaw = typeof source.generatedAt === "string" ? source.generatedAt : "";
  const generatedAt = Number.isFinite(Date.parse(generatedAtRaw))
    ? generatedAtRaw
    : "2026-11-24T00:00:00.000Z";

  return {
    generatedAt,
    dixonColes: normalizeDixonColes(source.dixonColes),
    elo: normalizeElo(source.elo),
    eloConfig: normalizeEloConfig(source.eloConfig),
  };
}

/** Carga y normaliza el artefacto estático sin acceso al filesystem. */
export function loadModelArtifact(): ModelArtifact {
  return normalizeArtifact(artifactJson);
}

export function emptyModelArtifact(): ModelArtifact {
  return {
    generatedAt: "2026-11-24T00:00:00.000Z",
    dixonColes: {
      params: { ...DEFAULT_DIXON_COLES_PARAMS },
      leagueAverage: 1.4,
      attack: {},
      defense: {},
    },
    elo: {},
    eloConfig: { ...DEFAULT_ELO_CONFIG },
  };
}
