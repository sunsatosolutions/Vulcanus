/**
 * Working directories are lowercase far more often than project names are
 * ("acme", "labs", "kiln"). Capitalize the leading letter so the generated
 * notes read as names, without guessing at word boundaries inside the token —
 * the wizard lets the operator correct anything this gets wrong.
 */
export function prettifyDirName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  // Leave names that already carry deliberate casing alone (API, WebApp).
  if (trimmed !== trimmed.toLowerCase()) return trimmed;
  return trimmed.charAt(0).toLocaleUpperCase("tr") + trimmed.slice(1);
}
