/**
 * Commit messages: Conventional Commits, but loose. The hook only checks that a message has a
 * type and a subject. Case, length and the list of types are left to the author, so a good
 * message is never rejected for a formatting detail.
 */
const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [0],
    "subject-case": [0],
    "subject-full-stop": [0],
    "header-max-length": [2, "always", 200],
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
export default config;
