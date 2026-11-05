// Chain groups that are contracted on one total target.
//
// The dashboard only knows branch names ("DR SPECS - PBJ", "JAC'S OPTOMETRY-JABI"),
// so a chain is a name pattern. G&A Retails is the parent of all six chains; it
// never appears in the data itself.

export const GROUP_NAME = "G&A Retails";

export const CHAINS = [
  { key: "jac", label: "Jac's Optometry", test: /^JAC'?S OPTOMETRY/i },
  { key: "drspecs", label: "Dr. Specs", test: /^DR\.? ?SPECS\b/i },
  { key: "mag", label: "Mag Eyewear", test: /^MAG EYEWEAR/i },
  { key: "optics81", label: "Optics 81", test: /^OPTICS ?81\b/i },
  { key: "maxvision", label: "Max Vision", test: /^MAX ?VISION/i },
  { key: "specshouse", label: "Specs House", test: /^SPECS HOUSE\b/i },
];

// Names that look like a chain but are not clearly one of its branches
// ("KK SPECS HOUSE"). They are offered, but unticked until someone confirms.
const LOOSE = [{ key: "specshouse", test: /^[A-Z]{1,3} SPECS HOUSE\b/i }];

export const chainByKey = (key) => CHAINS.find((c) => c.key === key) || null;

// The chain a customer name belongs to, or null. `loose` also matches the
// uncertain names above.
export function chainOf(name, { loose = false } = {}) {
  const n = String(name || "").trim();
  for (const c of CHAINS) if (c.test.test(n)) return c;
  if (loose) for (const l of LOOSE) if (l.test.test(n)) return chainByKey(l.key);
  return null;
}

// Every customer name in `names` that belongs to one of the chains in
// `chainKeys` (all chains when omitted), with whether it is a sure match.
// Returns [{ name, chain, sure }] sorted by chain then name.
export function chainBranches(names, chainKeys) {
  const want = chainKeys ? new Set(chainKeys) : null;
  const out = [];
  const seen = new Set();
  for (const raw of names || []) {
    const name = String(raw || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const sure = chainOf(name);
    const chain = sure || chainOf(name, { loose: true });
    if (!chain || (want && !want.has(chain.key))) continue;
    out.push({ name, chain, sure: !!sure });
  }
  const order = (b) => CHAINS.findIndex((c) => c.key === b.chain.key);
  return out.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}
