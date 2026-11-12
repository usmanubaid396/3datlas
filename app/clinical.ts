export interface ClinicalEntry {
  name: string;
  id: string;
  conceptId: string;
  details: string;
  clinicalCondition: string;
  clinicalScenario: string;
}

type ClinicalIndex = {
  v?: number;
  n?: number;
  c?: string[];
  i?: string[][];
  version?: number;
  count?: number;
  chunks?: string[];
};

const cache = new Map<string, ClinicalEntry>();
const chunkCache = new Map<string, Promise<boolean>>();
let indexPromise: Promise<ClinicalIndex | null> | null = null;
let idToChunk: Map<string, string> | null = null;
let prefetchStarted = false;
let singleFileLoaded = false;

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

/** Returns true if chunk data was loaded. */
async function loadChunk(file: string): Promise<boolean> {
  let pending = chunkCache.get(file);
  if (pending) return pending;
  pending = (async () => {
    try {
      const r = await fetch(`/models/${file}`);
      if (!r.ok) return false;
      const data = (await r.json()) as Record<string, ClinicalEntry>;
      let n = 0;
      for (const [id, e] of Object.entries(data)) {
        if (e && typeof e === 'object' && 'details' in e) {
          cache.set(id, e);
          n++;
        }
      }
      return n > 0;
    } catch {
      return false;
    }
  })();
  chunkCache.set(file, pending);
  return pending;
}

async function mapPool(items: string[], limit: number, fn: (item: string) => Promise<boolean>): Promise<void> {
  const q = [...items];
  const workers = Array.from({ length: Math.min(limit, q.length) }, async () => {
    while (q.length) {
      const item = q.shift();
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}

async function loadSingleFile(): Promise<void> {
  if (singleFileLoaded) return;
  singleFileLoaded = true;
  try {
    const r = await fetch('/models/clinical-data.json');
    if (!r.ok) return;
    const extra = (await r.json()) as Record<string, ClinicalEntry>;
    if (!extra || typeof extra !== 'object') return;
    for (const [id, e] of Object.entries(extra)) {
      if (e && typeof e === 'object' && 'details' in e) cache.set(id, e);
    }
  } catch {
    /* ignore */
  }
}

function startBackgroundPrefetch(chunks: string[]) {
  if (prefetchStarted || chunks.length === 0) return;
  prefetchStarted = true;
  const run = () => {
    void mapPool(chunks, 4, loadChunk);
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => run(), { timeout: 3000 });
  } else {
    setTimeout(run, 600);
  }
}

/** Warm clinical-data.json + index. Does not block on all chunks. */
export function loadClinicalAnatomy(): Promise<Map<string, ClinicalEntry>> {
  return (async () => {
    await loadSingleFile();
    const index = await getIndex();
    if (index) {
      const chunks = index.c ?? index.chunks ?? [];
      // Only prefetch when index has id lists (chunks actually exist in deploy)
      if (index.i && index.i.length === chunks.length && chunks.length > 0) {
        startBackgroundPrefetch(chunks);
      }
    }
    return cache;
  })();
}

/** Load the chunk for this part (or fall back to full scan once). */
export async function ensureClinicalForPart(
  partId?: string,
  partName?: string,
  conceptId?: string,
): Promise<ClinicalEntry | null> {
  await loadSingleFile();

  // Fast path from cache
  const hit = clinicalForPart(cache, partId, partName, conceptId);
  if (hit) return hit;

  const index = await getIndex();
  if (partId && idToChunk?.has(partId)) {
    await loadChunk(idToChunk.get(partId)!);
  } else if (index) {
    const chunks = index.c ?? index.chunks ?? [];
    // Only attempt chunk load if we have a real id map; otherwise clinical-data.json is the source
    if (idToChunk && idToChunk.size > 0 && chunks.length > 0) {
      // Unknown id: try a few early chunks then stop (avoid 71x 404)
      await mapPool(chunks.slice(0, 8), 4, loadChunk);
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
