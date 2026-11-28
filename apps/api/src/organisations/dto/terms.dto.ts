import { IsObject } from 'class-validator';

export class AcceptTermsDto {
  /** The version of each document the person read, by document key. */
  @IsObject()
  versions!: Record<string, string>;
}
