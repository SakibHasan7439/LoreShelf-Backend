/** Collapse Unicode whitespace, trim the result, and apply English lowercase. */
export function normalizeAuthorName(name: string): string {
  return name.replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en');
}

/** Keep a readable display form while sharing the same whitespace rule. */
export function normalizeAuthorDisplayName(name: string): string {
  return name.replace(/\s+/gu, ' ').trim();
}
