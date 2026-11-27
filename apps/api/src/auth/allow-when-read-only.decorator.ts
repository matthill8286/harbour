import { SetMetadata } from '@nestjs/common';

export const ALLOW_WHEN_READ_ONLY = 'allowWhenReadOnly';

/**
 * A change that stays possible while a lapsed plan has made a workspace
 * read-only: anything about a person's own sign-in or their own data, switching
 * away, and taking someone's access away.
 */
export const AllowWhenReadOnly = () => SetMetadata(ALLOW_WHEN_READ_ONLY, true);
