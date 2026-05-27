import { extractBehavioral, type PostRecord } from '../../src/features/behavioral.js';

function makePosts(count: number, overrides: Partial<PostRecord> = {}): PostRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    createdAt: 1_700_000_000 + i * 3_600,
    subreddit: i % 2 === 0 ? 'programming' : 'gaming',
    isTopLevel: i % 3 !== 0,
    ...overrides,
  }));
}

describe('extractBehavioral — empty input', () => {
  const result = extractBehavioral([]);

  it('returns 24-bucket hour histogram', () => expect(result.postingHours).toHaveLength(24));
  it('returns 7-bucket day histogram', () => expect(result.postingDays).toHaveLength(7));
  it('returns empty sub interests', () => expect(Object.keys(result.subInterests)).toHaveLength(0));
  it('returns 0 depth ratio', () => expect(result.commentDepthRatio).toBe(0));
  it('returns 0 median gap', () => expect(result.medianInterPostGapMinutes).toBe(0));
});

describe('extractBehavioral — hour histogram', () => {
  it('sums to 1', () => {
    const result = extractBehavioral(makePosts(24));
    expect(result.postingHours.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });

  it('has 24 buckets', () => {
    expect(extractBehavioral(makePosts(10)).postingHours).toHaveLength(24);
  });
});

describe('extractBehavioral — day histogram', () => {
  it('sums to 1', () => {
    const result = extractBehavioral(makePosts(7));
    expect(result.postingDays.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });

  it('has 7 buckets', () => {
    expect(extractBehavioral(makePosts(7)).postingDays).toHaveLength(7);
  });
});

describe('extractBehavioral — sub interests', () => {
  it('captures at most 30 subreddits', () => {
    const posts: PostRecord[] = Array.from({ length: 100 }, (_, i) => ({
      createdAt: 1_700_000_000 + i * 60,
      subreddit: `sub_${i}`,
      isTopLevel: true,
    }));
    const result = extractBehavioral(posts);
    expect(Object.keys(result.subInterests).length).toBeLessThanOrEqual(30);
  });

  it('most posted sub has highest frequency', () => {
    const posts: PostRecord[] = [
      ...Array.from({ length: 10 }, (_, i) => ({ createdAt: 1_700_000_000 + i * 60, subreddit: 'dominant', isTopLevel: true })),
      ...Array.from({ length: 2 }, (_, i) => ({ createdAt: 1_700_001_000 + i * 60, subreddit: 'rare', isTopLevel: true })),
    ];
    const result = extractBehavioral(posts);
    const sorted = Object.entries(result.subInterests).sort((a, b) => b[1] - a[1]);
    expect(sorted[0][0]).toBe('dominant');
  });
});

describe('extractBehavioral — comment depth ratio', () => {
  it('is 0 when all top-level', () => {
    expect(extractBehavioral(makePosts(10, { isTopLevel: true })).commentDepthRatio).toBe(0);
  });

  it('is 1 when all nested', () => {
    expect(extractBehavioral(makePosts(10, { isTopLevel: false })).commentDepthRatio).toBe(1);
  });
});

describe('extractBehavioral — median gap', () => {
  it('returns 0 for single post', () => {
    expect(extractBehavioral(makePosts(1)).medianInterPostGapMinutes).toBe(0);
  });

  it('returns 60 for posts 1 hour apart', () => {
    expect(extractBehavioral(makePosts(10)).medianInterPostGapMinutes).toBeCloseTo(60, 1);
  });
});