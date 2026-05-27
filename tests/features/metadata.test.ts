import { extractMetadata, type UserRecord } from '../../src/features/metadata.js';

const BAN_TIMESTAMP = 1_700_000_000;

const BASE_USER: UserRecord = {
  createdAt: BAN_TIMESTAMP - 30 * 24 * 60 * 60,
  commentKarma: 500,
  postKarma: 100,
  username: 'CoolDude1234',
  hasVerifiedEmail: true,
  iconImg: 'https://reddit.com/icon.png',
};

describe('extractMetadata — accountAgeDays', () => {
  it('computes 30 days correctly', () => {
    const result = extractMetadata(BASE_USER, BAN_TIMESTAMP);
    expect(Math.round(result.accountAgeDays)).toBe(30);
  });

  it('returns 0 for brand new account', () => {
    const result = extractMetadata({ ...BASE_USER, createdAt: BAN_TIMESTAMP }, BAN_TIMESTAMP);
    expect(result.accountAgeDays).toBe(0);
  });
});

describe('extractMetadata — usernamePattern', () => {
  const cases: Array<[string, ReturnType<typeof extractMetadata>['usernamePattern']]> = [
    ['CoolDude1234', 'name_number'],
    ['BigBear99', 'name_number'],
    ['randomword', 'dictionary'],
    ['HelloWorld', 'dictionary'],
    ['x9k2mz3', 'random'],
    ['abc_123_def', 'random'],
  ];

  for (const [username, expected] of cases) {
    it(`classifies "${username}" as "${expected}"`, () => {
      const result = extractMetadata({ ...BASE_USER, username }, BAN_TIMESTAMP);
      expect(result.usernamePattern).toBe(expected);
    });
  }
});

describe('extractMetadata — karmaTrajectory', () => {
  it('is steep for high karma per day', () => {
    const result = extractMetadata({ ...BASE_USER, commentKarma: 50_000, postKarma: 5_000 }, BAN_TIMESTAMP);
    expect(result.karmaTrajectory).toBe('steep');
  });

  it('is gradual for moderate karma per day', () => {
    const result = extractMetadata(BASE_USER, BAN_TIMESTAMP);
    expect(result.karmaTrajectory).toBe('gradual');
  });

  it('is flat for very low karma', () => {
    const oldUser = { ...BASE_USER, createdAt: BAN_TIMESTAMP - 1_000 * 24 * 60 * 60, commentKarma: 10, postKarma: 5 };
    const result = extractMetadata(oldUser, BAN_TIMESTAMP);
    expect(result.karmaTrajectory).toBe('flat');
  });
});

describe('extractMetadata — profileComplete', () => {
  it('is true when email verified and icon set', () => {
    expect(extractMetadata(BASE_USER, BAN_TIMESTAMP).profileComplete).toBe(true);
  });

  it('is false when email not verified', () => {
    expect(extractMetadata({ ...BASE_USER, hasVerifiedEmail: false }, BAN_TIMESTAMP).profileComplete).toBe(false);
  });

  it('is false when icon is empty string', () => {
    expect(extractMetadata({ ...BASE_USER, iconImg: '' }, BAN_TIMESTAMP).profileComplete).toBe(false);
  });

  it('is false when icon is undefined', () => {
    expect(extractMetadata({ ...BASE_USER, iconImg: undefined }, BAN_TIMESTAMP).profileComplete).toBe(false);
  });
});