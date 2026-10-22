import { IsString, MaxLength, MinLength } from 'class-validator';

/** The page's text, as the DOM-tree analysis formats it. */
export const OAK_JD_SHOT_TEXT_MAX = 400_000;

export class OakJdShotDto {
  @IsString()
  @MinLength(1)
  @MaxLength(OAK_JD_SHOT_TEXT_MAX)
  pageText!: string;
}
