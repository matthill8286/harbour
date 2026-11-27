import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQuery } from '../../common/pagination';

export class JobListQuery extends PageQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  status?: string;

  /** A route's id. The default route also takes jobs not yet given a route. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  route?: string;

  /** A stage's id, or `completed`. Ignored when `status` is given. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  stage?: string;
}
