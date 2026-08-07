/**
 * Version arithmetic for the release script, kept separate so it can be tested
 * on its own. Running the release script itself to check the arithmetic means
 * the test also depends on the repository's CHANGELOG state, and that state
 * legitimately changes the moment a release is cut.
 */

const EXPLICIT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Resolve `bump` — an explicit version, or `major`/`minor`/`patch` — against
 * the current version. Throws on anything else rather than guessing.
 */
export function nextVersion(from, bump) {
  if (EXPLICIT.test(bump)) return bump;

  const [major, minor, patch] = from.split(".").map(Number);
  if ([major, minor, patch].some((part) => !Number.isInteger(part))) {
    throw new Error(`Current version is not semver: ${from}`);
  }

  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Not a version or bump keyword: ${bump}`);
}
