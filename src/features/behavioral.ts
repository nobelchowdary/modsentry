import type { BehavioralFeatures } from '../types.js';

export interface PostRecord {
  createdAt: number;
  subreddit: string;
  isTopLevel: boolean;
}

export function extractBehavioral(posts: PostRecord[]): BehavioralFeatures {
  if (posts.length === 0) {
    return {
      postingHours: new Array(24).fill(0) as number[],
      postingDays: new Array(7).fill(0) as number[],
      subInterests: {},
      commentDepthRatio: 0,
      medianInterPostGapMinutes: 0,
    };
  }

  const sorted = [...posts].sort((a, b) => a.createdAt - b.createdAt);

  return {
    postingHours: computeHourHistogram(posts),
    postingDays: computeDayHistogram(posts),
    subInterests: computeSubInterests(posts),
    commentDepthRatio: computeDepthRatio(posts),
    medianInterPostGapMinutes: computeMedianGapMinutes(sorted),
  };
}

function computeHourHistogram(posts: PostRecord[]): number[] {
  const buckets = new Array(24).fill(0) as number[];
  for (const p of posts) {
    const hour = new Date(p.createdAt * 1000).getUTCHours();
    buckets[hour]++;
  }
  return normalizeArr(buckets);
}

function computeDayHistogram(posts: PostRecord[]): number[] {
  const buckets = new Array(7).fill(0) as number[];
  for (const p of posts) {
    const day = new Date(p.createdAt * 1000).getUTCDay();
    buckets[day]++;
  }
  return normalizeArr(buckets);
}

function computeSubInterests(posts: PostRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of posts) {
    counts[p.subreddit] = (counts[p.subreddit] ?? 0) + 1;
  }
  const total = posts.length;
  return Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([sub, count]) => [sub, count / total]),
  );
}

function computeDepthRatio(posts: PostRecord[]): number {
  if (posts.length === 0) return 0;
  return posts.filter(p => !p.isTopLevel).length / posts.length;
}

function computeMedianGapMinutes(sortedPosts: PostRecord[]): number {
  if (sortedPosts.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < sortedPosts.length; i++) {
    gaps.push((sortedPosts[i].createdAt - sortedPosts[i - 1].createdAt) / 60);
  }
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid];
}

function normalizeArr(arr: number[]): number[] {
  const total = arr.reduce((a, b) => a + b, 0);
  if (total === 0) return arr;
  return arr.map(v => v / total);
}