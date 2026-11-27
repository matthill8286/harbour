import {
  isISO8601,
  Matches,
  ValidateBy,
  ValidateIf,
  type ValidationOptions,
} from 'class-validator';

/**
 * May be left out, but may not be null: for a column that always has a value.
 * `@IsOptional()` lets null through to the database.
 */
export function IfSent() {
  return ValidateIf((_, value) => value !== undefined);
}

/** A date, or a date and time. */
const DATE_SHAPE =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$/;

export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

export function isRealDate(value: unknown): boolean {
  if (typeof value !== 'string' || !DATE_SHAPE.test(value)) return false;
  // Strict refuses days that do not exist, such as 31 February.
  if (!isISO8601(value, { strict: true })) return false;
  const year = Number(value.slice(0, 4));
  return (
    year >= MIN_YEAR &&
    year <= MAX_YEAR &&
    !Number.isNaN(new Date(value).getTime())
  );
}

/**
 * `@IsDateString()` accepts days that do not exist, and forms such as a bare
 * year or week that JavaScript cannot read.
 */
export function IsRealDate(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isRealDate',
      validator: {
        validate: isRealDate,
        defaultMessage: (args) =>
          `${args?.property} must be a real date, such as 2026-03-31`,
      },
    },
    options,
  );
}

/** A two-letter country code, such as GB. */
export function IsCountryCode() {
  return Matches(/^[A-Za-z]{2}$/, {
    message: '$property must be a two-letter country code',
  });
}

/** A three-letter currency code, such as EUR. */
export function IsCurrencyCode() {
  return Matches(/^[A-Za-z]{3}$/, {
    message: '$property must be a three-letter currency code',
  });
}
