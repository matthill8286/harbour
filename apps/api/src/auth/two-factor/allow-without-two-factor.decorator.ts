import { SetMetadata } from '@nestjs/common';

export const ALLOW_WITHOUT_TWO_FACTOR = 'allowWithoutTwoFactor';

/** Lets staff who have not set up two-factor sign-in reach this route, so they can set it up. */
export const AllowWithoutTwoFactor = () =>
  SetMetadata(ALLOW_WITHOUT_TWO_FACTOR, true);
