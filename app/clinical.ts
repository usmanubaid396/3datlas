export interface ClinicalEntry {
  name: string;
  id: string;
  conceptId: string;
  details: string;
  clinicalCondition: string;
  clinicalScenario: string;
}

/** Compact index: c = chunk filenames, i = part-id lists parallel to c */
type ClinicalIndex = {
  v?: number;
  n?: number;
  c: string[];
  i?: string[][];
  // legacy
  version?: number;
  count?: number;
  chunks?: string[];
};

const cache = new Map<string, ClinicalEntry>();
const chunkCache = new Map<string, Promise<void>>();
let indexPromise: Promise<ClinicalIndex | null> | null = null;
let idToChunk: Map<string, string> | null = null;
let prefetchStarted = false;

function getIndex(): Promise<ClinicalIndex | null> {
  if (!indexPromise) {
    indexPromise = fetch('/models/clinical-index.json')
      .then(r => (r.ok ? (r.json() as Promise<ClinicalIndex>) : null))
      .then(index => {
        if (!index) return null;
        const chunks = index.c ?? index.chunks ?? [];
        const idLists = index.i;
        idToChunk = new Map();
        if (idLists && idLists.length === chunks.length) {
          idLists.forEach((ids, n) => {
            const file = chunks[n];
            for (const id of ids) idToChunk!.set(id, file);
          });
        }
        return index;
      })
      .catch(() => null);
  }
  return indexPromise;
}

async function loadChunk(file: string): Promise<void> {
  let pending = chunkCache.get(file);
  if (pending) return pending;
  pending = (async () => {
    try {
      const r = await fetch(`/models/${file}`);
      if (!r.ok) return;
      const data = (await r.json()) as Record<string, ClinicalEntry>;
      for (const [id, e] of Object.entries(data)) {
        if (e && typeof e === 'object' && 'details' in e) cache.set(id, e);
      }
    } catch {
      /* ignore failed chunk */
    }
  })();
  chunkCache.set(file, pending);
  return pending;
}

/** Load up to `limit` chunk requests at a time. */
async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const q = [...items];
  const workers = Array.from({ length: Math.min(limit, q.length) }, async () => {
    while (q.length) {
      const item = q.shift();
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}

function startBackgroundPrefetch(chunks: string[]) {
  if (prefetchStarted || chunks.length === 0) return;
  prefetchStarted = true;
  const run = () => {
    void mapPool(chunks, 4, loadChunk);
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => run(), { timeout: 2500 });
  } else {
    setTimeout(run, 400);
  }
}

/**
 * Warm index + optional single-file data. Does NOT download all 71 chunks up front.
 * Returns the shared cache map (grows as chunks load).
 */
export function loadClinicalAnatomy(): Promise<Map<string, ClinicalEntry>> {
  return (async () => {
    // Optional single-file override (small starter set or full file if user installed it)
    try {
      const singleRes = await fetch('/models/clinical-data.json');
      if (singleRes.ok) {
        const extra = (await singleRes.json()) as Record<string, ClinicalEntry>;
        if (extra && typeof extra === 'object') {
          for (const [id, e] of Object.entries(extra)) {
            if (e && typeof e === 'object' && 'details' in e) cache.set(id, e);
          }
        }
      }
    } catch {
      /* ignore */
    }

    const index = await getIndex();
    if (index) {
      const chunks = index.c ?? index.chunks ?? [];
      // Prefetch in background with concurrency 4 — UI stays responsive
      startBackgroundPrefetch(chunks);
    }

    return cache;
  })();
}

/** Ensure the chunk containing this part is loaded, then resolve the entry. */
export async function ensureClinicalForPart(
  partId?: string,
  partName?: string,
  conceptId?: string,
): Promise<ClinicalEntry | null> {
  const index = await getIndex();
  if (partId && idToChunk?.has(partId)) {
    await loadChunk(idToChunk.get(partId)!);
  } else if (index && (partName || conceptId || partId)) {
    // Legacy index without id lists: load all chunks (bounded concurrency)
    const chunks = index.c ?? index.chunks ?? [];
    if (!idToChunk || idToChunk.size === 0) {
      await mapPool(chunks, 6, loadChunk);
    }
  }

  return clinicalForPart(cache, partId, partName, conceptId);
}

export function clinicalForPart(
  map: Map<string, ClinicalEntry> | null | undefined,
  partId: string | undefined,
  partName: string | undefined,
  conceptId?: string,
): ClinicalEntry | null {
  const m = map ?? cache;
  if (!m || m.size === 0) return null;
  if (partId && m.has(partId)) return m.get(partId)!;
  if (conceptId) {
    for (const e of m.values()) {
      if (e.conceptId === conceptId) return e;
    }
  }
  if (partName) {
    const key = partName.toLowerCase();
    for (const e of m.values()) {
      if (e.name.toLowerCase() === key) return e;
    }
  }
  return null;
}
