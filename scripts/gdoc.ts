// Effect helpers
import { Effect } from 'effect';

export function extractDocId(input: string): string | undefined {
  try {
    const u = new URL(input);
    if (!u.hostname.includes('docs.google.com')) return undefined;
    const segments = u.pathname.split('/').filter(Boolean);
    // Handle:
    // - /document/d/<id>
    // - /document/u/<n>/d/<id>
    // - /a/<domain>/document/d/<id>
    let id: string | undefined;
    for (let i = 0; i < segments.length; i++) {
      if (segments[i] !== 'document') continue;
      // direct form: /document/d/<id>
      if (segments[i + 1] === 'd' && segments[i + 2]) {
        id = segments[i + 2];
        break;
      }
      // user-shard: /document/u/<n>/d/<id>
      if (segments[i + 1] === 'u' && segments[i + 3] === 'd' && segments[i + 4]) {
        // Optional: ensure segments[i+2] is digits
        const shard = segments[i + 2] ?? '';
        let allDigits = shard.length > 0;
        for (let k = 0; k < shard.length; k++) {
          const c = shard.charCodeAt(k);
          if (c < 48 || c > 57) {
            allDigits = false;
            break;
          }
        }
        if (allDigits) {
          id = segments[i + 4];
          break;
        }
      }
    }
    if (!id) return undefined;
    // Validate allowed characters [A-Za-z0-9_-] without using regex
    for (let i = 0; i < id.length; i++) {
      const c = id.charCodeAt(i);
      const ch = id[i];
      const isAZ = c >= 65 && c <= 90;
      const isaz = c >= 97 && c <= 122;
      const is09 = c >= 48 && c <= 57;
      if (!(isAZ || isaz || is09 || ch === '_' || ch === '-')) return undefined;
    }
    return id;
  } catch {
    return undefined;
  }
}

export const DEFAULT_DOC_URL =
  'https://docs.google.com/document/d/1s41KPlsesw6fJR5FKVGPVniTwg6duvtluSzIakAeUZw/edit?tab=t.0#heading=h.6ghsgs5bvvge';


export const extractDocIdEffect = (input: string) =>
  Effect.sync(() => extractDocId(input)).pipe(
    Effect.flatMap((id) => (id ? Effect.succeed(id) : Effect.fail(new Error('Invalid Google Docs URL')))),
  );
