import type { Fingerprint, StylometricFeatures } from '../types.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export function scoreMatch(candidate: Fingerprint, banned: Fingerprint): number {
  const [candidateNgram, bannedNgram] = alignVectors(
    candidate.stylometric.charNgrams,
    banned.stylometric.charNgrams,
  );
  const [candidateSub, bannedSub] = alignVectors(
    candidate.behavioral.subInterests,
    banned.behavioral.subInterests,
  );

  // Weights sum exactly to 1.00
  const stylometricScore =
    0.35 * cosineSimilarity(candidateNgram, bannedNgram) +
    0.18 * cosineSimilarity(
      toFuncWordVector(candidate.stylometric),
      toFuncWordVector(banned.stylometric),
    );

  const behavioralScore =
    0.13 * (1 - jensenShannon(candidate.behavioral.postingHours, banned.behavioral.postingHours)) +
    0.09 * cosineSimilarity(candidateSub, bannedSub) +
    0.04 * (1 - jensenShannon(candidate.behavioral.postingDays, banned.behavioral.postingDays));

  const stylometricBonus =
    0.03 * normalizedSimilarity(candidate.stylometric.avgSentenceLength, banned.stylometric.avgSentenceLength, 20) +
    0.02 * (1 - Math.abs(candidate.stylometric.punctuationRate - banned.stylometric.punctuationRate) / 10) +
    0.02 * (1 - Math.abs(candidate.stylometric.allCapsRate - banned.stylometric.allCapsRate)) +
    0.01 * (1 - Math.abs(candidate.stylometric.emojiRate - banned.stylometric.emojiRate)) +
    0.02 * (1 - Math.abs(candidate.stylometric.sentenceInitialCapRate - banned.stylometric.sentenceInitialCapRate));

  const behavioralBonus =
    0.02 * (1 - Math.abs(candidate.behavioral.commentDepthRatio - banned.behavioral.commentDepthRatio)) +
    0.02 * normalizedSimilarity(candidate.behavioral.medianInterPostGapMinutes, banned.behavioral.medianInterPostGapMinutes, 120);

  const metadataBonus =
    0.01 * (candidate.metadata.usernamePattern === banned.metadata.usernamePattern ? 1 : 0) +
    0.01 * (candidate.metadata.karmaTrajectory === banned.metadata.karmaTrajectory ? 1 : 0);

  const phraseScore =
    0.03 * bigramOverlap(candidate.stylometric.topBigrams, banned.stylometric.topBigrams);

  const temporalScore =
    0.02 * accountCreatedAfterBan(candidate, banned);

  // 0.35+0.18+0.13+0.09+0.04+0.03+0.02+0.02+0.01+0.02+0.02+0.01+0.01+0.03+0.02 = 1.00
  const raw = stylometricScore + behavioralScore + stylometricBonus + behavioralBonus + metadataBonus + phraseScore + temporalScore;

  return Math.round(Math.min(raw * 100, 100));
}

export function explainMatch(
  candidate: Fingerprint,
  banned: Fingerprint,
): Array<{ feature: string; contribution: number; detail: string }> {
  const [candidateNgram, bannedNgram] = alignVectors(
    candidate.stylometric.charNgrams,
    banned.stylometric.charNgrams,
  );
  const [candidateSub, bannedSub] = alignVectors(
    candidate.behavioral.subInterests,
    banned.behavioral.subInterests,
  );

  const ngramSim = cosineSimilarity(candidateNgram, bannedNgram);
  const funcSim  = cosineSimilarity(toFuncWordVector(candidate.stylometric), toFuncWordVector(banned.stylometric));
  const hourSim  = 1 - jensenShannon(candidate.behavioral.postingHours, banned.behavioral.postingHours);
  const daySim   = 1 - jensenShannon(candidate.behavioral.postingDays, banned.behavioral.postingDays);
  const subSim   = cosineSimilarity(candidateSub, bannedSub);
  const bigrams  = bigramOverlap(candidate.stylometric.topBigrams, banned.stylometric.topBigrams);
  const temporal = accountCreatedAfterBan(candidate, banned);
  const sentLen  = normalizedSimilarity(candidate.stylometric.avgSentenceLength, banned.stylometric.avgSentenceLength, 20);
  const depth    = 1 - Math.abs(candidate.behavioral.commentDepthRatio - banned.behavioral.commentDepthRatio);

  return [
    { feature: 'Writing style',      contribution: Math.round(ngramSim * 35), detail: `Character-level writing patterns match at ${Math.round(ngramSim * 100)}%` },
    { feature: 'Function words',     contribution: Math.round(funcSim * 18),  detail: `Common word usage patterns match at ${Math.round(funcSim * 100)}%` },
    { feature: 'Posting hours',      contribution: Math.round(hourSim * 13),  detail: `Both users post at similar times of day (${Math.round(hourSim * 100)}% overlap)` },
    { feature: 'Subreddit interests',contribution: Math.round(subSim * 9),   detail: `Similar subreddit activity patterns (${Math.round(subSim * 100)}% overlap)` },
    { feature: 'Posting days',       contribution: Math.round(daySim * 4),   detail: `Similar day-of-week posting patterns (${Math.round(daySim * 100)}% overlap)` },
    { feature: 'Phrase patterns',    contribution: Math.round(bigrams * 3),  detail: `${Math.round(bigrams * 100)}% of frequent phrase pairs are shared` },
    { feature: 'Sentence length',    contribution: Math.round(sentLen * 3),  detail: `Average sentence length is ${Math.round(Math.abs(candidate.stylometric.avgSentenceLength - banned.stylometric.avgSentenceLength))} words apart` },
    { feature: 'Comment depth',      contribution: Math.round(depth * 2),    detail: `Similar top-level vs reply posting habits` },
    { feature: 'Account timing',     contribution: Math.round(temporal * 2), detail: temporal > 0.5 ? `Account created ${Math.round(candidate.metadata.accountAgeDays)} days after the ban` : 'Account age not suspicious' },
  ].sort((a, b) => b.contribution - a.contribution);
}

// ─── Core math ────────────────────────────────────────────────────────────────

function alignVectors(
  a: Record<string, number>,
  b: Record<string, number>,
): [number[], number[]] {
  const allKeys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
  return [
    allKeys.map(k => a[k] ?? 0),
    allKeys.map(k => b[k] ?? 0),
  ];
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : Math.min(dot / denom, 1);
}

function jensenShannon(p: number[], q: number[]): number {
  if (p.length !== q.length || p.length === 0) return 1;
  const m = p.map((pi, i) => (pi + q[i]) / 2);
  return Math.sqrt((klDivergence(p, m) + klDivergence(q, m)) / 2);
}

function klDivergence(p: number[], q: number[]): number {
  let sum = 0;
  for (let i = 0; i < p.length; i++) {
    if (p[i] > 0 && q[i] > 0) sum += p[i] * Math.log(p[i] / q[i]);
  }
  return sum;
}

function bigramOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  return a.filter(bg => setB.has(bg)).length / Math.max(a.length, b.length);
}

function normalizedSimilarity(a: number, b: number, maxDiff: number): number {
  return Math.max(0, 1 - Math.abs(a - b) / maxDiff);
}

function accountCreatedAfterBan(candidate: Fingerprint, banned: Fingerprint): number {
  const candidateCreatedAt = candidate.capturedAt - candidate.metadata.accountAgeDays * 86400;
  const banTimestamp = banned.capturedAt;
  const daysSinceBan = candidate.metadata.accountAgeDays;
  if (candidateCreatedAt > banTimestamp && daysSinceBan < 30) return 1;
  if (candidateCreatedAt > banTimestamp && daysSinceBan < 90) return 0.5;
  return 0;
}

// ─── Vector builders ──────────────────────────────────────────────────────────

function toFuncWordVector(s: StylometricFeatures): number[] {
  return Object.keys(s.functionWordFreq).sort().map(k => s.functionWordFreq[k] ?? 0);
}