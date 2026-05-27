import { extractStylometric } from '../../src/features/stylometric.js';

const SAMPLE_TEXTS = [
  "Honestly, I think this is a great point. The community should really consider this carefully.",
  "Honestly, you're missing the point here. The evidence is clear and the logic follows.",
  "I honestly believe that we need to reconsider. The data supports this view entirely.",
];

describe('extractStylometric — empty input', () => {
  const result = extractStylometric([]);

  it('returns empty charNgrams', () => {
    expect(Object.keys(result.charNgrams)).toHaveLength(0);
  });

  it('returns empty topBigrams', () => {
    expect(result.topBigrams).toHaveLength(0);
  });

  it('returns zero numeric features', () => {
    expect(result.avgSentenceLength).toBe(0);
    expect(result.punctuationRate).toBe(0);
    expect(result.emojiRate).toBe(0);
  });
});

describe('extractStylometric — character n-grams', () => {
  const result = extractStylometric(SAMPLE_TEXTS);

  it('returns at most 200 entries', () => {
    expect(Object.keys(result.charNgrams).length).toBeLessThanOrEqual(200);
  });

  it('all trigrams are exactly 3 characters', () => {
    for (const key of Object.keys(result.charNgrams)) {
      expect(key).toHaveLength(3);
    }
  });

  it('all values are normalized between 0 and 1', () => {
    for (const v of Object.values(result.charNgrams)) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('extractStylometric — function word frequency', () => {
  const result = extractStylometric(SAMPLE_TEXTS);

  it('frequency of "the" is positive', () => {
    expect(result.functionWordFreq['the']).toBeGreaterThan(0);
  });

  it('all values are between 0 and 1', () => {
    for (const v of Object.values(result.functionWordFreq)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('extractStylometric — sentence length', () => {
  const result = extractStylometric(SAMPLE_TEXTS);

  it('avgSentenceLength is positive', () => {
    expect(result.avgSentenceLength).toBeGreaterThan(0);
  });

  it('stdSentenceLength is non-negative', () => {
    expect(result.stdSentenceLength).toBeGreaterThanOrEqual(0);
  });
});

describe('extractStylometric — emoji rate', () => {
  it('returns 0 for plain text', () => {
    const result = extractStylometric(SAMPLE_TEXTS);
    expect(result.emojiRate).toBe(0);
  });

  it('detects emojis', () => {
    const result = extractStylometric(['Hello 😊 world 🎉']);
    expect(result.emojiRate).toBeGreaterThan(0);
  });
});

describe('extractStylometric — top bigrams', () => {
  const result = extractStylometric(SAMPLE_TEXTS);

  it('returns at most 20 bigrams', () => {
    expect(result.topBigrams.length).toBeLessThanOrEqual(20);
  });

  it('each bigram has exactly one space', () => {
    for (const bg of result.topBigrams) {
      expect(bg.split(' ')).toHaveLength(2);
    }
  });
});