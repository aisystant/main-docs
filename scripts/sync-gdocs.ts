import { sanitizeFilename } from './sanitize.ts';
import { extractDocIdEffect, DEFAULT_DOC_URL } from './gdoc.ts';
import ky from 'ky';
import { Effect, Duration } from 'effect';
import { mkdir, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';

// No Drive API metadata usage; public export only

const OUTDIR = 'gdocs';
const DEFAULT_EXPORTS = 'txt,docx';
const EXPORTS: string[] = (process.env.GDOC_EXPORTS || DEFAULT_EXPORTS)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter((s) => !!s);

const parseFilenameFromContentDisposition = (cd?: string): string | undefined => {
  if (!cd) return undefined;
  const parts = cd.split(';');
  for (const partRaw of parts) {
    const part = partRaw.trim();
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    let value = part.slice(eq + 1).trim();
    if (key === 'filename*') {
      const dqu = value.indexOf("''");
      const encoded = dqu >= 0 ? value.slice(dqu + 2) : value;
      if (encoded.startsWith('"') && encoded.endsWith('"')) value = encoded.slice(1, -1);
      else value = encoded;
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
    if (key === 'filename') {
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      return value;
    }
  }
  return undefined;
};

const stripExtension = (name: string): string => {
  const lastSlash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const lastDot = name.lastIndexOf('.');
  return lastDot > lastSlash ? name.slice(0, lastDot) : name;
};

// Ky instance; public access only
const http = ky.create({
  // We handle retry/backoff via Effect for clarity and control
  retry: 0,
  throwHttpErrors: false,
});

const tryKy = (url: string) =>
  Effect.tryPromise({
    try: () => http.get(url),
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  });

const fetchWithRetry = (url: string, max = 5) =>
  Effect.gen(function* (_) {
    let attempt = 0;
    while (attempt < max) {
      const res = yield* _(tryKy(url).pipe(Effect.catchAll(() => Effect.succeed<Response | undefined>(undefined as any))));
      if (res) {
        if (res.ok) return res as unknown as Response;
        const retriable = res.status === 429 || (res.status >= 500 && res.status < 600);
        if (!retriable) return res as unknown as Response;
      }
      const backoff = Math.min(1000 * 2 ** attempt, 10_000);
      yield* _(Effect.sleep(Duration.millis(backoff)));
      attempt++;
    }
    // final attempt (propagate error if thrown)
    const last = (yield* _(tryKy(url))) as unknown as Response;
    return last;
  });

const ensureOutDir = Effect.tryPromise({
  try: async () => {
    await mkdir(OUTDIR, { recursive: true });
  },
  catch: (e) => (e instanceof Error ? e : new Error(String(e))),
});

// No Drive API calls are used anymore

const saveResponseToFile = (res: Response, outPath: string) =>
  Effect.gen(function* (_) {
    const ab = yield* _(Effect.tryPromise({ try: () => res.arrayBuffer(), catch: (e) => (e instanceof Error ? e : new Error(String(e))) }));
    yield* _(
      Effect.tryPromise({
        try: () => writeFile(outPath, new Uint8Array(ab)),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }),
    );
  });

const exportGoogleDocFormats = (id: string, formats: readonly string[]) =>
  Effect.gen(function* (_) {
    for (const fmt of formats) {
      const publicUrl = `https://docs.google.com/document/d/${id}/export?format=${fmt}`;
      const res = yield* _(fetchWithRetry(publicUrl));
      if (!res.ok) {
        const txt = yield* _(Effect.tryPromise({ try: () => res.text(), catch: () => Promise.resolve('') }));
        return yield* _(Effect.fail(new Error(`Public export error for ${id} (${fmt}) ${res.status}: ${txt}`)));
      }
      const cd = res.headers.get('content-disposition') ?? undefined;
      const header = parseFilenameFromContentDisposition(cd);
      const base = sanitizeFilename(stripExtension(header || '')) || `document-${id}`;
      let target: string;
      if (fmt === 'txt') {
        // Save txt export as .md for convenience
        target = `${OUTDIR}/${base}.md`;
      } else {
        // Keep original extension if provided, else append fmt
        const nameWithExt = header ? sanitizeFilename(header) : `${base}.${fmt}`;
        target = `${OUTDIR}/${nameWithExt}`;
      }
      yield* _(saveResponseToFile(res, target));
      console.log(`Saved: ${target}`);
    }
  });

export const syncGDocsFromUrl = (url: string) =>
  Effect.gen(function* (_) {
    yield* _(ensureOutDir);
    const docId = yield* _(extractDocIdEffect(url));
    yield* _(exportGoogleDocFormats(docId, EXPORTS));
  });

// Optional CLI entry (Bun/Node compatible)
const isMain = (import.meta as any).main ?? (typeof process !== 'undefined' && process.argv && process.argv[1] === fileURLToPath(import.meta.url));
if (isMain) {
  const url = process.argv[2] || process.env.GDOC_URL || process.env.GDRIVE_URL || DEFAULT_DOC_URL;
  Effect.runPromise(syncGDocsFromUrl(url)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
