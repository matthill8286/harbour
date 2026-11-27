import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

/**
 * An email address, with spaces around it removed before it is checked. Browser
 * autofill and pasting from a note often add one, and the address is still right.
 */
export function TrimmedEmail() {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
    IsEmail(),
  );
}
