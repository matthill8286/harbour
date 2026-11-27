const MINUTE = 60 * 1000;
const QUARTER_HOUR = 15 * MINUTE;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const per = (limit: number, windowMs: number) => ({ limit, windowMs });

/**
 * Every limit in one place. An "Ip" limit counts one address, which an office
 * may share, so it is looser than the limit on one account.
 */
export const RATE_LIMITS = {
  loginIp: per(30, QUARTER_HOUR),
  /** Wrong passwords for one email, at sign-in and when accepting an invite. */
  passwordAccount: per(10, QUARTER_HOUR),
  twoFactorIp: per(30, QUARTER_HOUR),
  twoFactorAccount: per(10, QUARTER_HOUR),
  signupIp: per(5, HOUR),
  signupEmail: per(3, HOUR),
  signupConfirmIp: per(30, QUARTER_HOUR),
  forgotPasswordIp: per(10, HOUR),
  forgotPasswordEmail: per(5, HOUR),
  resetPasswordIp: per(30, QUARTER_HOUR),
  resetPasswordAccount: per(10, QUARTER_HOUR),
  invitePreviewIp: per(60, QUARTER_HOUR),
  invitePreviewAccount: per(30, QUARTER_HOUR),
  inviteAcceptIp: per(30, QUARTER_HOUR),
  inviteAcceptAccount: per(20, QUARTER_HOUR),
  inviteSendIp: per(40, HOUR),
  inviteSendUser: per(30, HOUR),
  inviteSendOrganisation: per(50, DAY),
} as const;

export type RateLimitPolicy = keyof typeof RATE_LIMITS;
