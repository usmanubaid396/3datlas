export interface ClinicalEntry {
  name: string;
  id: string;
  conceptId: string;
  details: string;
  clinicalCondition: string;
  clinicalScenario: string;
}

const EMBEDDED: Record<string, ClinicalEntry> = JSON.parse(
  '{"FJ3176":{"name":"Atlas","id":"FJ3176","conceptId":"FMA12519","details":"First cervical vertebra; ring-shaped, lacking body and spinous process; lateral masses carry occipital condyles above and axis below; vertebral artery grooves its posterior arch.","clinicalCondition":"Jefferson burst fracture — axial load through the skull splits the ring, displacing lateral masses outward.","clinicalScenario":"A 22-year-old dives into shallow water and strikes his head; he has severe neck pain and CT shows a four-part burst fracture of C1."},"FJ3177":{"name":"Axis","id":"FJ3177","conceptId":"FMA12520","details":"Second cervical vertebra; its odontoid process (dens) projects upward and is held against the atlas by the transverse ligament, forming the pivot for head rotation.","clinicalCondition":"Odontoid fracture — elderly falls; type II fractures risk nonunion and spinal cord injury.","clinicalScenario":"An 82-year-old woman falls face-first at home; CT reveals a type II dens fracture and she is fitted with a rigid cervical collar."}}',
);

let cache: Map<string, ClinicalEntry> | null = null;

export function loadClinicalAnatomy(): Promise<Map<string, ClinicalEntry>> {
  if (cache) return Promise.resolve(cache);
  cache = new Map(Object.entries(EMBEDDED));
  return fetch('/models/clinical-data.json')
    .then(r => (r.ok ? r.json() : null))
    .then((extra: Record<string, ClinicalEntry> | null) => {
      if (extra && typeof extra === 'object') {
        for (const [id, e] of Object.entries(extra)) {
          if (e && typeof e === 'object' && 'details' in e) cache!.set(id, e as ClinicalEntry);
        }
      }
      return cache!;
    })
    .catch(() => cache!);
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
