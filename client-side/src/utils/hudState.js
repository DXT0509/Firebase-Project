/**
 * Purpose:
 * - Build a presentation-ready HUD snapshot from realtime client state.
 *
 * Responsibilities:
 * - Compute rank rows, level progression, and attack cooldown display data.
 *
 * Key concepts:
 * - This function is pure and deterministic for easier UI updates.
 */
import {
  EVOWARS_XP_TABLE,
  MAX_LEVEL,
  getAttackDelayByLevel,
} from '../constants/gameConfig';
import { getLevelFromScore } from './physics';

/**
 * Inputs:
 * - `clients`: synchronized render client map.
 * - `myId`: local player id.
 * - `fallbackScore`: local score fallback while sync catches up.
 * - `lastSwingTime`: timestamp of latest attack.
 * - `now`: current timestamp (default `Date.now()`).
 *
 * Output:
 * - HUD object consumed by `GameHud`.
 */
export const buildHudState = (
  clients,
  myId,
  fallbackScore,
  lastSwingTime,
  now = Date.now(),
) => {
  const safeClients = clients || {};

  const clientsArray = Object.entries(safeClients).map(([id, c]) => ({
    id,
    name: c?.name || id.slice(0, 4).toUpperCase(),
    score: typeof c?.score === 'number' ? c.score : 0,
    kills: typeof c?.kills === 'number' ? c.kills : 0,
  }));

  const sortedByKills = [...clientsArray].sort(
    (a, b) => (b.kills - a.kills) || (b.score - a.score),
  );
  const rankMap = {};
  sortedByKills.forEach((c, idx) => {
    rankMap[c.id] = idx + 1;
  });

  const myIndex = sortedByKills.findIndex((c) => c.id === myId);
  const syncedScore = safeClients?.[myId]?.score;
  const myScoreValue = typeof syncedScore === 'number' ? syncedScore : fallbackScore;

  const myLevel = getLevelFromScore(myScoreValue);
  const myNextLevel = Math.min(MAX_LEVEL, myLevel + 1);

  const currentLevelEntry = EVOWARS_XP_TABLE.find((e) => e.level === myLevel) || EVOWARS_XP_TABLE[0];
  const nextLevelEntry = EVOWARS_XP_TABLE.find((e) => e.level === myNextLevel) || currentLevelEntry;

  const currScoreForLevel = currentLevelEntry.score;
  const nextScoreForLevel = nextLevelEntry.score;
  const scoreForBar = Math.max(0, myScoreValue - currScoreForLevel);
  const scoreNeededForBar = Math.max(1, nextScoreForLevel - currScoreForLevel);
  const levelProgress = Math.max(0, Math.min(1, scoreForBar / scoreNeededForBar));

  const attackCooldownMs = getAttackDelayByLevel(myLevel);
  const attackCooldownRemaining = Math.max(0, attackCooldownMs - (now - lastSwingTime));
  const attackCooldownProgress = attackCooldownMs > 0 ? attackCooldownRemaining / attackCooldownMs : 0;

  // Keep leaderboard compact while preserving local player context.
  let leaderboardRows = [];
  if (sortedByKills.length <= 5) {
    leaderboardRows = sortedByKills;
  } else if (myIndex !== -1 && myIndex < 4) {
    leaderboardRows = sortedByKills.slice(0, 5);
  } else {
    const top4 = sortedByKills.slice(0, 4);
    const meRow = sortedByKills.find((c) => c.id === myId);
    leaderboardRows = meRow ? [...top4, meRow] : top4;
  }

  return {
    myId,
    myLevel,
    myScoreValue,
    nextScoreForLevel,
    levelProgress,
    attackCooldownRemaining,
    attackCooldownProgress,
    leaderboardRows,
    rankMap,
  };
};
