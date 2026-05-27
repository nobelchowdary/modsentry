import type { MetadataFeatures } from '../types.js';

export interface UserRecord {
  createdAt: number;
  commentKarma: number;
  postKarma: number;
  username: string;
  hasVerifiedEmail: boolean;
  iconImg?: string;
}

export function extractMetadata(user: UserRecord, banTimestamp: number): MetadataFeatures {
  return {
    accountAgeDays: computeAccountAge(user.createdAt, banTimestamp),
    karmaTrajectory: estimateKarmaTrajectory(user, banTimestamp),
    usernamePattern: classifyUsername(user.username),
    profileComplete: isProfileComplete(user),
  };
}

function computeAccountAge(createdAt: number, referenceTime: number): number {
  return (referenceTime - createdAt) / (60 * 60 * 24);
}

function estimateKarmaTrajectory(user: UserRecord, referenceTime: number): MetadataFeatures['karmaTrajectory'] {
  const totalKarma = user.commentKarma + user.postKarma;
  const ageDays = Math.max(
    (referenceTime - user.createdAt) / (60 * 60 * 24),
    1,
  );
  const karmaPerDay = totalKarma / ageDays;
  if (karmaPerDay > 50) return 'steep';
  if (karmaPerDay > 5) return 'gradual';
  return 'flat';
}

function classifyUsername(username: string): MetadataFeatures['usernamePattern'] {
  if (/^[A-Z][a-z]+[A-Z][a-z]+\d{2,4}$/.test(username)) return 'name_number';
  if (/^[a-zA-Z]+$/.test(username)) return 'dictionary';
  return 'random';
}

function isProfileComplete(user: UserRecord): boolean {
  return user.hasVerifiedEmail && !!user.iconImg && user.iconImg.trim() !== '';
}