/** Joins the folders and the file name of a bulk-uploaded résumé into its alias. */
export const ALIAS_SEPARATOR = "-";

const PATH_SEPARATOR = /[/\\]/;

/** One path part as it reads in an alias: lowercase, runs of whitespace become the separator. */
const aliasPart = (part: string) => part.trim().toLowerCase().replace(/\s+/g, ALIAS_SEPARATOR);

/** The parts of a browser-relative path, without empty segments. */
export const pathParts = (relativePath: string) =>
  relativePath.split(PATH_SEPARATOR).filter(Boolean);

/**
 * Alias of a résumé picked as part of a folder. The path is relative to the picked folder, so
 * `Resume/FullStack/Java/David.docx` picked as `Resume` becomes `fullstack-java-david.docx`.
 * A file with no folder in its path (not a directory pick) is aliased by its own name.
 */
export function aliasFromPath(relativePath: string): string {
  const parts = pathParts(relativePath);
  const below = parts.length > 1 ? parts.slice(1) : parts;
  return below.map(aliasPart).filter(Boolean).join(ALIAS_SEPARATOR);
}
