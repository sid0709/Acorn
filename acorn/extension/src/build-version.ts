/**
 * This build's version, from acorn/extension/package.json (the build writes it into the bundle). State the
 * extension keeps in the browser outlives the code that wrote it, so what is kept is stamped with it and
 * what another build kept is not read.
 */
export const EXTENSION_BUILD: string = import.meta.env?.VITE_ACORN_VERSION ?? "dev";
