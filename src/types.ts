export interface StylometricFeatures {
  charNgrams: Record<string, number>;
  functionWordFreq: Record<string, number>;
  avgSentenceLength: number;
  stdSentenceLength: number;
  punctuationRate: number;
  allCapsRate: number;
  sentenceInitialCapRate: number;
  emojiRate: number;
  topBigrams: string[];
}

export interface BehavioralFeatures {
  postingHours: number[];
  postingDays: number[];
  subInterests: Record<string, number>;
  commentDepthRatio: number;
  medianInterPostGapMinutes: number;
}

export interface MetadataFeatures {
  accountAgeDays: number;
  karmaTrajectory: 'steep' | 'gradual' | 'flat';
  usernamePattern: 'name_number' | 'dictionary' | 'random';
  profileComplete: boolean;
}

export interface Fingerprint {
  userId: string;
  username: string;
  subreddit: string;
  stylometric: StylometricFeatures;
  behavioral: BehavioralFeatures;
  metadata: MetadataFeatures;
  capturedAt: number;
  banReason: string;
  confirmedAltsCount: number;
  status: 'active' | 'low-confidence';
  postCount: number;
}

export interface SubConfig {
  thresholdSoft: number;
  thresholdHard: number;
  autoAction: boolean;
  sharedRegistry: boolean;
  sharedTeamId?: string;
}

export const DEFAULT_CONFIG: SubConfig = {
  thresholdSoft: 70,
  thresholdHard: 85,
  autoAction: false,
  sharedRegistry: false,
};