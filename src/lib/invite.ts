/**
 * The crew code in a pasted invite: a full link (https://…/crew/abc12345,
 * with or without a trailing slash, query or hash), a bare path, or just the
 * code. Null when it doesn't look like one.
 */
export function inviteCode(text: string): string | null {
  const t = text.trim();
  const m = t.match(/\/crew\/([a-z0-9]+)\/?(?:[?#].*)?$/i) ?? t.match(/^([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : null;
}
