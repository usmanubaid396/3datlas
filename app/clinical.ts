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
  nameToIds: Record<string, string[]>;
};

let cache: Map<string, ClinicalEntry> | null = null;
let nameIndex: Record<string, string[]> = {};
let loading: Promise<Map<string, ClinicalEntry>> | null = null;

export function loadClinicalAnatomy(): Promise<Map<string, ClinicalEntry>> {
  if (cache) return Promise.resolve(cache);
  if (loading) return loading;
  loading = (async () => {
    const index = (await fetch('/models/clinical-index.json').then(r => {
      if (!r.ok) throw new Error('Clinical anatomy index could not be loaded.');
      return r.json();
    })) as ClinicalIndex;
    nameIndex = index.nameToIds ?? {};
    const maps = await Promise.all(
      index.chunks.map(name =>
        fetch(`/models/${name}`).then(r => {
          if (!r.ok) throw new Error(`Clinical anatomy chunk ${name} failed to load.`);
          return r.json() as Promise<Record<string, ClinicalEntry>>;
        }),
      ),
    );
    const map = new Map<string, ClinicalEntry>();
    for (const chunk of maps) {
      for (const [id, entry] of Object.entries(chunk)) map.set(id, entry);
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
): ClinicalEntry | null {
  if (!map) return null;
  if (partId && map.has(partId)) return map.get(partId)!;
  if (partName) {
    const ids = nameIndex[partName.toLowerCase()];
    if (ids) {
      for (const id of ids) {
        const e = map.get(id);
        if (e) return e;
      }
    }
  }
  return null;
}
