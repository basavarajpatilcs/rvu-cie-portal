// ============================================================
// Teaching-Learning Pedagogy (TLP) module — loads the pedagogy
// type / assessment method reference lists and provides the
// per-section entry defaults + validation used across the TLP
// page. Reuses the SAME section rows the existing section
// tracker uses (data.js's flattenSections) rather than any new
// course data, so this feature adds zero new course records.
// ============================================================

let cache = null;

export async function loadTlpReference() {
  if (cache) return cache;
  const res = await fetch("data/tlp-reference.json");
  if (!res.ok) throw new Error("Could not load data/tlp-reference.json");
  cache = await res.json();
  return cache;
}

/** Merges the built-in reference list with any admin-added extras (from
 *  Settings → TLP Options), de-duplicating by name so re-adding an
 *  existing name is harmless. */
export function mergeTlpOptions(ref, extras) {
  const dedupe = (base, added) => {
    const seen = new Set(base.map((x) => x.name.toLowerCase()));
    const out = [...base];
    for (const item of added || []) {
      if (item.name && !seen.has(item.name.toLowerCase())) {
        out.push({ name: item.name, description: item.description || "" });
        seen.add(item.name.toLowerCase());
      }
    }
    return out;
  };
  return {
    ...ref,
    pedagogyTypes: dedupe(ref.pedagogyTypes, extras?.extraPedagogyTypes),
    assessmentMethods: dedupe(ref.assessmentMethods, extras?.extraAssessmentMethods),
  };
}

export function emptyTlpDoc(section) {
  return {
    courseKey: section.courseKey, tab: section.tab, programme: section.programme,
    semester: section.semester, code: section.code, name: section.name,
    section: section.section, faculty: section.faculty,
    pedagogyTypes: [],
    ictTools: "",
    cie1: { pedagogyType: "", assessmentStyle: "" },
    cie3: { pedagogyType: "", assessmentStyle: "" },
    updatedBy: null, updatedAt: null,
  };
}

/** A section's TLP entry is "complete" once it meets the minimum pedagogy
 *  type count and both CIE-1/CIE-3 pedagogy+assessment pairs are chosen. */
export function computeTlpStatus(doc, minPedagogyTypes) {
  const pedagogyCount = (doc.pedagogyTypes || []).length;
  const meetsMin = pedagogyCount >= minPedagogyTypes;
  const cie1Done = !!(doc.cie1?.pedagogyType && doc.cie1?.assessmentStyle);
  const cie3Done = !!(doc.cie3?.pedagogyType && doc.cie3?.assessmentStyle);

  let status = "Not Started";
  if (pedagogyCount > 0 || cie1Done || cie3Done) status = "In Progress";
  if (meetsMin && cie1Done && cie3Done) status = "Completed";

  return { pedagogyCount, meetsMin, cie1Done, cie3Done, status };
}

export const PROGRAMME_TABS = ["BTech", "BCA", "BSc", "MTech", "Minors", "UE"];
