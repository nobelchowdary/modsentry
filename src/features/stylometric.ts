import type { StylometricFeatures } from '../types.js';

const FUNCTION_WORDS = new Set([
  'the', 'of', 'and', 'a', 'to', 'in', 'is', 'you', 'that', 'it',
  'he', 'was', 'for', 'on', 'are', 'as', 'with', 'his', 'they', 'i',
  'at', 'be', 'this', 'have', 'from', 'or', 'one', 'had', 'by', 'not',
  'but', 'what', 'all', 'were', 'we', 'when', 'your', 'can', 'said', 'there',
  'use', 'an', 'each', 'which', 'she', 'do', 'how', 'their', 'if', 'will',
]);

const EMOJI_RE = /\p{Emoji_Presentation}/gu;
const PUNCTUATION_RE = /[.,!?;:'"()\[\]{}\-–—]/g;
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;
const WORD_RE = /\b[a-z']+\b/g;

const NGRAM_SIZE = 3;
const TOP_NGRAMS = 200;
const TOP_BIGRAMS = 20;

export function extractStylometric(texts: string[]): StylometricFeatures {
  if (texts.length === 0) return emptyFeatures();

  const combined = texts.join('\n');
  const words = tokenizeLower(combined);
  const sentences = splitSentences(combined);

  return {
    charNgrams: computeCharNgrams(combined, NGRAM_SIZE, TOP_NGRAMS),
    functionWordFreq: computeFunctionWordFreq(words),
    avgSentenceLength: computeAvg(sentences.map(wordCount)),
    stdSentenceLength: computeStd(sentences.map(wordCount)),
    punctuationRate: computePunctuationRate(combined),
    allCapsRate: computeAllCapsRate(combined),
    sentenceInitialCapRate: computeSentenceInitialCapRate(sentences),
    emojiRate: computeEmojiRate(combined),
    topBigrams: computeTopBigrams(words, TOP_BIGRAMS),
  };
}

function computeCharNgrams(text: string, n: number, topK: number): Record<string, number> {
  const cleaned = text.toLowerCase().replace(/\s+/g, ' ');
  const counts: Record<string, number> = {};

  for (let i = 0; i <= cleaned.length - n; i++) {
    const gram = cleaned.slice(i, i + n);
    counts[gram] = (counts[gram] ?? 0) + 1;
  }

  const total = Math.max(Object.values(counts).reduce((s, v) => s + v, 0), 1);

  return Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([k, v]) => [k, v / total]),
  );
}

function computeFunctionWordFreq(words: string[]): Record<string, number> {
  const total = Math.max(words.length, 1);
  const freq: Record<string, number> = {};
  for (const fw of FUNCTION_WORDS) freq[fw] = 0;
  for (const w of words) {
    if (FUNCTION_WORDS.has(w)) freq[w] = (freq[w] ?? 0) + 1;
  }
  for (const fw of FUNCTION_WORDS) freq[fw] = freq[fw] / total;
  return freq;
}

function computePunctuationRate(text: string): number {
  const matches = text.match(PUNCTUATION_RE) ?? [];
  return (matches.length / Math.max(text.length, 1)) * 100;
}

function computeAllCapsRate(text: string): number {
  const tokens = text.match(/\b[A-Za-z]{2,}\b/g) ?? [];
  if (tokens.length === 0) return 0;
  return tokens.filter(t => t === t.toUpperCase()).length / tokens.length;
}

function computeSentenceInitialCapRate(sentences: string[]): number {
  if (sentences.length === 0) return 0;
  return sentences.filter(s => /^[A-Z]/.test(s.trimStart())).length / sentences.length;
}

function computeEmojiRate(text: string): number {
  const emojis = text.match(EMOJI_RE) ?? [];
  return (emojis.length / Math.max(text.length, 1)) * 100;
}

function computeTopBigrams(words: string[], topK: number): string[] {
  const counts: Record<string, number> = {};
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    counts[bigram] = (counts[bigram] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([bigram]) => bigram);
}

function tokenizeLower(text: string): string[] {
  return text.toLowerCase().match(WORD_RE) ?? [];
}

function splitSentences(text: string): string[] {
  return text.split(SENTENCE_SPLIT_RE).map(s => s.trim()).filter(s => s.length > 0);
}

function wordCount(sentence: string): number {
  return sentence.split(/\s+/).filter(Boolean).length;
}

function computeAvg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function computeStd(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = computeAvg(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length);
}

function emptyFeatures(): StylometricFeatures {
  return {
    charNgrams: {},
    functionWordFreq: Object.fromEntries([...FUNCTION_WORDS].map(w => [w, 0])),
    avgSentenceLength: 0,
    stdSentenceLength: 0,
    punctuationRate: 0,
    allCapsRate: 0,
    sentenceInitialCapRate: 0,
    emojiRate: 0,
    topBigrams: [],
  };
}