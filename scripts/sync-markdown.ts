import { promises as fs }   from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ky from "ky";
import { Effect } from "effect";

const SKIP_DIRS = new Set([".git", ".github", "node_modules", "dist", "build", ".next", ".vercel", ".cache"]);

const SRC_DIR = "source";
const OUT_DIR = "docs";
const CLEAN = true;
const HEADING = true;

export function extnameNoDot(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ext.startsWith(".") ? ext.slice(1) : ext;
}

export function toDestPath(rel: string, outDir: string): string {
  const ext = extnameNoDot(rel);
  const base = ext ? rel.slice(0, -path.extname(rel).length) : rel;
  const mdRel = ext && ext !== "md" && ext !== "markdown" ? base + ".md" : rel;
  return path.join(outDir, mdRel);
  }

// Effectful filesystem helpers
const ensureDirE = (dir: string) =>
  Effect.tryPromise(() => fs.mkdir(dir, { recursive: true })).pipe(Effect.as(void 0));

const removeDirE = (dir: string) =>
  Effect.tryPromise(() => fs.rm(dir, { recursive: true, force: true })).pipe(Effect.as(void 0));

export const existsE = (p: string) =>
  Effect.tryPromise(() => fs.access(p)).pipe(
    Effect.map(() => true),
    Effect.catchAll(() => Effect.succeed(false))
  );

const writeIfChangedE = (dest: string, content: string | Uint8Array) => {
  const parent = path.dirname(dest);
  const ensure = ensureDirE(parent);

  const writeStringIfChanged = (c: string) =>
    existsE(dest).pipe(
      Effect.flatMap((exists) =>
        exists
          ? Effect.tryPromise(() => fs.readFile(dest, "utf8")).pipe(
              Effect.catchAll(() => Effect.succeed("")),
              Effect.flatMap((prior) =>
                prior === c
                  ? Effect.succeed<void>(undefined)
                  : Effect.tryPromise(() => fs.writeFile(dest, c)).pipe(Effect.as(void 0))
              )
            )
          : Effect.tryPromise(() => fs.writeFile(dest, c)).pipe(Effect.as(void 0))
      )
    );

  const writeBufferIfChanged = (buf: Uint8Array) => {
    const b = Buffer.from(buf);
    return existsE(dest).pipe(
      Effect.flatMap((exists) =>
        exists
          ? Effect.tryPromise(() => fs.readFile(dest)).pipe(
              Effect.catchAll(() => Effect.succeed(Buffer.alloc(0))),
              Effect.flatMap((prior) =>
                prior.length === b.length && prior.equals(b)
                  ? Effect.succeed<void>(undefined)
                  : Effect.tryPromise(() => fs.writeFile(dest, b)).pipe(Effect.as(void 0))
              )
            )
          : Effect.tryPromise(() => fs.writeFile(dest, b)).pipe(Effect.as(void 0))
      )
    );
  };

  return ensure.pipe(
    Effect.flatMap(() =>
      typeof content === "string"
        ? writeStringIfChanged(content)
        : writeBufferIfChanged(content)
    )
  );
};

export function buildGDocExportUrl(url: string): string | null {
  const marker = "/document/d/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const start = idx + marker.length;
  const end = url.indexOf("/", start) === -1 ? url.length : url.indexOf("/", start);
  const id = url.slice(start, end);
  return id ? `https://docs.google.com/document/d/${id}/export?format=txt` : null;
}

function extractGDocId(url: string): string | null {
  const marker = "/document/d/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const start = idx + marker.length;
  const end = url.indexOf("/", start) === -1 ? url.length : url.indexOf("/", start);
  const id = url.slice(start, end);
  return id || null;
}

const fetchGDocTextE = (url: string) =>
  Effect.tryPromise(async () => {
    const res = await ky.get(url, {
      headers: { "user-agent": "node-sync-markdown/0.1" },
      throwHttpErrors: false,
    });
    if (!res.ok) return null;
    return await res.text();
  }).pipe(Effect.catchAll(() => Effect.succeed<string | null>(null)));

const fetchGDocTextWithTokenE = (id: string, token: string) =>
  Effect.tryPromise(async () => {
    const endpoint = `https://www.googleapis.com/drive/v3/files/${id}/export`;
    const url = `${endpoint}?mimeType=text/plain`;
    const res = await ky.get(url, {
      headers: {
        "authorization": `Bearer ${token}`,
        "user-agent": "node-sync-markdown/0.1",
      },
      throwHttpErrors: false,
    });
    if (!res.ok) return null;
    return await res.text();
  }).pipe(Effect.catchAll(() => Effect.succeed<string | null>(null)));

export type GDocMeta = { url?: string; name?: string; title?: string };

export function parseGDocMeta(jsonText: string, fallbackTitle: string): { url: string; title: string } {
  let url = "";
  let title = fallbackTitle;
  try {
    const meta = JSON.parse(jsonText) as GDocMeta;
    url = (meta.url || "").trim();
    title = (meta.title || meta.name || title).trim();
  } catch {}
  return { url, title };
}

const processOneE = (srcRoot: string, outRoot: string, rel: string) => {
  const ext = extnameNoDot(rel);
  if (ext === "md" || ext === "markdown") {
    return Effect.tryPromise(() => fs.readFile(path.join(srcRoot, rel))).pipe(
      Effect.flatMap((data) => writeIfChangedE(path.join(outRoot, rel), data)),
      Effect.as(1 as number)
    );
  }

  if (ext === "gdoc") {
    const abs = path.join(srcRoot, rel);
    return Effect.tryPromise(() => fs.readFile(abs, "utf8")).pipe(
      Effect.map((text) => {
        let titleBase = path.basename(rel);
        if (titleBase.toLowerCase().endsWith(".gdoc")) titleBase = titleBase.slice(0, -5);
        return parseGDocMeta(text, titleBase);
      }),
      Effect.flatMap(({ url, title }) => {
        const token = process.env.GOOGLE_ACCESS_TOKEN || "";
        const id = url ? extractGDocId(url) : null;
        const exportUrl = url ? buildGDocExportUrl(url) : null;
        const fetchedE = token && id
          ? fetchGDocTextWithTokenE(id, token)
          : (exportUrl ? fetchGDocTextE(exportUrl) : Effect.succeed<string | null>(null));
        return fetchedE.pipe(
          Effect.map((fetched) => {
            const body = fetched ? fetched.trim() : "";
            let md = HEADING ? `# ${title}\n\n` : "";
            if (body) {
              md += body + "\n";
            } else {
              if (url) md += `Source: ${url}\n\n`;
              md += "_Content not fetched (auth required or not public)._\n";
            }
            return md;
          }),
          Effect.flatMap((md) => writeIfChangedE(toDestPath(rel, outRoot), md)),
          Effect.as(1 as number)
        );
      })
    );
  }

  return Effect.succeed(0 as number);
};

const listFilesE = (srcRoot: string, ignoreRel?: string) =>
  Effect.tryPromise(async () => {
    const out: string[] = [];
    const stack: string[] = ["."];
    while (stack.length) {
      const rel = stack.pop()!;
      const dir = path.join(srcRoot, rel);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const childRel = rel === "." ? e.name : path.join(rel, e.name);
        if (ignoreRel && (childRel === ignoreRel || childRel.startsWith(ignoreRel + path.sep))) continue;
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name)) continue;
          stack.push(childRel);
        } else if (e.isFile()) {
          const ext = extnameNoDot(e.name);
          if (ext === "md" || ext === "markdown" || ext === "gdoc") out.push(childRel);
        }
      }
    }
    return out;
  });

export function syncEffect() {
  const srcRoot = path.resolve(SRC_DIR);
  const outRoot = path.resolve(OUT_DIR);

  return existsE(srcRoot).pipe(
    Effect.flatMap((ok) =>
      ok
        ? Effect.succeed<void>(undefined)
        : Effect.fail(new Error(`Source path not found: ${srcRoot}`))
    ),
    Effect.flatMap(() => (CLEAN ? removeDirE(outRoot) : Effect.succeed<void>(undefined))),
    Effect.flatMap(() => ensureDirE(outRoot)),
    Effect.flatMap(() => {
      let ignoreRel: string | undefined;
      if (outRoot.startsWith(srcRoot + path.sep)) ignoreRel = outRoot.slice(srcRoot.length + 1);
      return listFilesE(srcRoot, ignoreRel).pipe(
        Effect.flatMap((files) =>
          Effect.forEach(files, (rel) => processOneE(srcRoot, outRoot, rel), { concurrency: 4 }).pipe(
            Effect.map((results) => results.reduce((a, b) => a + b, 0))
          )
        )
      );
    })
  );
}

export async function run() {
  const count = await Effect.runPromise(syncEffect());
  console.log(`Synced ${count} file(s).`);
}

// Only run when executed directly
const isDirect = import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (isDirect) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
