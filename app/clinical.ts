export interface ClinicalEntry {
  name: string;
  id: string;
  conceptId: string;
  details: string;
  clinicalCondition: string;
  clinicalScenario: string;
}

type ClinicalIndex = {
  version: number;
  count: number;
  chunks: string[];
  nameToIds?: Record<string, string[]>;
};

let cache: Map<string, ClinicalEntry> | null = null;
let loading: Promise<Map<string, ClinicalEntry>> | null = null;

export function loadClinicalAnatomy(): Promise<Map<string, ClinicalEntry>> {
  if (cache) return Promise.resolve(cache);
  if (loading) return loading;

  loading = (async () => {
    const map = new Map<string, ClinicalEntry>();

    // Prefer chunked full dataset via index
    try {
      const indexRes = await fetch('/models/clinical-index.json');
      if (indexRes.ok) {
        const index = (await indexRes.json()) as ClinicalIndex;
        const chunks = index.chunks ?? [];
        const maps = await Promise.all(
          chunks.map(async name => {
            const r = await fetch(`/models/${name}`);
            if (!r.ok) return {} as Record<string, ClinicalEntry>;
            return (await r.json()) as Record<string, ClinicalEntry>;
          }),
        );
        for (const chunk of maps) {
          for (const [id, e] of Object.entries(chunk)) {
            if (e && typeof e === 'object' && 'details' in e) map.set(id, e);
          }
        }
      }
    } catch {
      /* fall through */
    }

    // Merge optional single-file override/extra
    try {
      const singleRes = await fetch('/models/clinical-data.json');
      if (singleRes.ok) {
        const extra = (await singleRes.json()) as Record<string, ClinicalEntry>;
        if (extra && typeof extra === 'object') {
          for (const [id, e] of Object.entries(extra)) {
            if (e && typeof e === 'object' && 'details' in e) map.set(id, e);
          }
        }
      }
    } catch {
      /* ignore */
    }

    cache = map;
    return map;
  })();

  return loading;
}

export function clinicalForPart(
  map: Map<string, ClinicalEntry> | null,
  partId: string | undefined,
  partName: string | undefined,
  conceptId?: string,
): ClinicalEntry | null {
  if (!map || map.size === 0) return null;
  if (partId && map.has(partId)) return map.get(partId)!;
  if (conceptId) {
    for (const e of map.values()) {
      if (e.conceptId === conceptId) return e;
    }
  }
  if (partName) {
    const key = partName.toLowerCase();
    for (const e of map.values()) {
      if (e.name.toLowerCase() === key) return e;
    }
  }
  return null;
}
