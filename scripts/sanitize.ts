/**
 * Cross-platform filename sanitizer for content sourced from Google Docs titles.
 * - Replaces reserved characters: / \ : * ? " < > |
 * - Removes control characters (including newlines, tabs, null)
 * - Trims and collapses whitespace
 * - Caps length to 200 chars for portability
 */
export function sanitizeFilename(name: string): string {
  const reserved = new Set(['/','\\',':','*','?','"','<','>','|']);
  let out = '';
  let lastSpace = false;
  for (let i = 0; i < name.length; i++) {
    const ch = name[i];
    const code = name.charCodeAt(i);
    // skip control chars (0x00-0x1F, 0x7F)
    if (code < 32 || code === 127) continue;
    let mapped = reserved.has(ch) ? '_' : ch;
    // normalize whitespace and collapse
    const isWs = ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\v' || ch === '\f';
    if (isWs) {
      if (!lastSpace) {
        out += ' ';
        lastSpace = true;
      }
    } else {
      out += mapped;
      lastSpace = false;
    }
    if (out.length >= 200) break;
  }
  // trim leading/trailing space
  if (out.startsWith(' ')) out = out.slice(1);
  if (out.endsWith(' ')) out = out.slice(0, -1);
  return out;
}
