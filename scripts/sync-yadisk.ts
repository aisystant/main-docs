import { sanitizeFilename } from './sanitize.ts';
import ky from 'ky';
import { Effect, Duration } from 'effect';
import { mkdir, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';

const OUTDIR = 'yadisk';
const DEFAULT_PUBLIC_URL = 'https://disk.yandex.ru/d/N2xaJZWo-hhFYw';

const http = ky.create({ retry: 0, throwHttpErrors: false });

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
    const last = (yield* _(tryKy(url))) as unknown as Response;
    return last;
  });

const ensureOutDir = Effect.tryPromise({
  try: async () => {
    await mkdir(OUTDIR, { recursive: true });
  },
  catch: (e) => (e instanceof Error ? e : new Error(String(e))),
});

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

const getYandexDownloadHref = (publicUrl: string) =>
  Effect.gen(function* (_) {
    const api = new URL('https://cloud-api.yandex.net/v1/disk/public/resources/download');
    api.searchParams.set('public_key', publicUrl);
    const res = yield* _(fetchWithRetry(api.toString()));
    if (!res.ok) {
      const txt = yield* _(Effect.tryPromise({ try: () => res.text(), catch: () => Promise.resolve('') }));
      return yield* _(Effect.fail(new Error(`Yandex API error ${res.status}: ${txt}`)));
    }
    const data = (yield* _(Effect.tryPromise({
      try: () => res.json() as Promise<any>,
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    }))) as any;
    const href = data && typeof data.href === 'string' ? data.href : undefined;
    if (!href) return yield* _(Effect.fail(new Error('Missing download href from Yandex API')));
    return href as string;
  });

export const syncYandexPublicFile = (publicUrl: string) =>
  Effect.gen(function* (_) {
    yield* _(ensureOutDir);
    const href = yield* _(getYandexDownloadHref(publicUrl));
    const res = yield* _(fetchWithRetry(href));
    if (!res.ok) {
      const txt = yield* _(Effect.tryPromise({ try: () => res.text(), catch: () => Promise.resolve('') }));
      return yield* _(Effect.fail(new Error(`Download error ${res.status}: ${txt}`)));
    }
    const cd = res.headers.get('content-disposition') ?? undefined;
    const headerName = parseFilenameFromContentDisposition(cd);
    const safeName = sanitizeFilename(headerName || 'yadisk-file.md');
    const target = `${OUTDIR}/${safeName}`;
    yield* _(saveResponseToFile(res, target));
    console.log(`Saved: ${target}`);
  });

// CLI entry
const isMain = (import.meta as any).main ?? (typeof process !== 'undefined' && process.argv && process.argv[1] === fileURLToPath(import.meta.url));
if (isMain) {
  const url = process.argv[2] || process.env.YADISK_URL || DEFAULT_PUBLIC_URL;
  Effect.runPromise(syncYandexPublicFile(url)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

