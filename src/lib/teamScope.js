// Salesperson scope shared by every tab's filter pills.
//
// selectedSP is one rep's name, "All" (every rep), or ALL_EX_HOUSE (every rep
// except the "Seed Malaysia" house / overseas account).

export const HOUSE_SP = "Seed Malaysia";
export const ALL_EX_HOUSE = "All-ex-house";

export const isTeamScope = (scope) => scope === "All" || scope === ALL_EX_HOUSE;

// Does a row booked under rep `sp` belong to `scope`?
export const spInScope = (sp, scope) =>
  scope === "All" || (scope === ALL_EX_HOUSE ? sp !== HOUSE_SP : sp === scope);

export const scopeName = (scope) =>
  scope === "All" ? "All Teams" : scope === ALL_EX_HOUSE ? `All Teams except ${HOUSE_SP}` : scope;

// Monthly target for a scope. "All" uses the company _TEAM target (HQ format);
// ALL_EX_HOUSE sums every rep's own target except the house account.
export const targetFor = (targets, scope, year, month) => {
  if (scope === ALL_EX_HOUSE) {
    return targets
      .filter((t) => t.year === year && t.month === month && !String(t.sp).startsWith("_") && t.sp !== HOUSE_SP)
      .reduce((a, t) => a + (Number(t.target) || 0), 0);
  }
  const sp = scope === "All" ? "_TEAM" : scope;
  const t = targets.find((x) => x.year === year && x.month === month && x.sp === sp);
  return t ? Number(t.target) || 0 : 0;
};
