// Customer x Brand roll-up for one year and salesperson scope.
//
// rows: { year, sp, customer, brand, amt, qty } (brand may be a Product Group
// label — the tab is dimension-agnostic). `metric` is "amt" (revenue) or "qty"
// (units) and decides how everything is ranked and shared.
//
// Returns
//   customers: ranked { customer, total, share, brands: [{ brand, value, amt, qty, share }] }
//   brands:    ranked { brand, total, share, customers: [{ customer, value, amt, qty, share }] }
//   total:     sum of the ranked customers' values (shares are of this)
//   topBrands: the biggest brands' names, the ones that get a colour in the stacked bars
//   pair:      Map("customer\u0000brand" -> { amt, qty }) for grid lookups
// Customers and brands whose net value is zero or negative (returns only) are
// left out of the rankings so every share is of real sales.

export const TOP_BRAND_COLOURS = 6;
export const pairKey = (customer, brand) => `${customer}\u0000${brand}`;

export function buildCustomerBrand(rows, year, sp, metric) {
  const key = metric === "qty" ? "qty" : "amt";
  const pair = new Map();
  for (const r of rows || []) {
    if (!r || r.year !== year || !r.customer || !r.brand) continue;
    if (sp !== "All" && r.sp !== sp) continue;
    const k = pairKey(r.customer, r.brand);
    const e = pair.get(k) || { customer: r.customer, brand: r.brand, amt: 0, qty: 0 };
    e.amt += Number(r.amt) || 0;
    e.qty += Number(r.qty) || 0;
    pair.set(k, e);
  }

  const byCustomer = new Map();
  const byBrand = new Map();
  for (const e of pair.values()) {
    const value = e[key];
    if (!byCustomer.has(e.customer)) byCustomer.set(e.customer, { customer: e.customer, total: 0, brands: [] });
    if (!byBrand.has(e.brand)) byBrand.set(e.brand, { brand: e.brand, total: 0, customers: [] });
    byCustomer.get(e.customer).total += value;
    byBrand.get(e.brand).total += value;
    byCustomer.get(e.customer).brands.push({ brand: e.brand, value, amt: e.amt, qty: e.qty });
    byBrand.get(e.brand).customers.push({ customer: e.customer, value, amt: e.amt, qty: e.qty });
  }

  const byValue = (a, b) => b.value - a.value;
  const customers = [...byCustomer.values()].filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
  const brands = [...byBrand.values()].filter((b) => b.total > 0).sort((a, b) => b.total - a.total);
  const total = customers.reduce((a, c) => a + c.total, 0);

  for (const c of customers) {
    c.brands = c.brands.filter((x) => x.value > 0).sort(byValue).map((x) => ({ ...x, share: x.value / c.total }));
    c.share = total > 0 ? c.total / total : 0;
  }
  const brandTotal = brands.reduce((a, b) => a + b.total, 0);
  for (const b of brands) {
    b.customers = b.customers.filter((x) => x.value > 0).sort(byValue).map((x) => ({ ...x, share: x.value / b.total }));
    b.share = brandTotal > 0 ? b.total / brandTotal : 0;
  }

  return {
    metric: key,
    customers,
    brands,
    total,
    topBrands: brands.slice(0, TOP_BRAND_COLOURS).map((b) => b.brand),
    pair,
  };
}
