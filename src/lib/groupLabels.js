// Readable names for the Autocount Stock-Group codes used in the
// "Stock Sales Analysis - Summary <year>.xlsx" cross-tab (customer × group).
//
// Codes carry two conventional suffixes:
//   PRM = promotional / free giveaway   TR / TT = trial lens
// Both are zero-revenue (quantity only). We keep them as their own rows but tag
// them so the UI can show a "Promo"/"Trial" chip and, if wanted, fold them away.
//
// This mapping is best-effort from the SEED catalogue and MAY need a tweak by
// someone who knows the codes — anything unmapped falls back to the raw code so
// nothing is hidden. Edit GROUP_LABELS to correct a name.

export const GROUP_LABELS = {
  // --- 1 Day Pure family ---
  "1DPR": "1 Day Pure",
  "1DPRPRM": "1 Day Pure",
  "1DTR": "1 Day Pure Trial",
  "1DTT": "1 Day Toric Trial",
  "1DPT": "1 Day Pure Astigmatism",
  "1DPTPRM": "1 Day Pure Astigmatism",
  "1DPE": "1 Day Pure EDOF",
  "1DPEPRM": "1 Day Pure EDOF",
  "1DPETR": "1 Day Pure EDOF Trial",
  "1DPS": "1 Day Pure Silfa",
  "1DPSPRM": "1 Day Pure Silfa",
  "1DPSTR": "1 Day Pure Silfa Trial",
  "1DMS": "1 Day Multistage",
  "1DMSPRM": "1 Day Multistage",
  "1DPVS": "1 Day View Support",
  "1DPRVSPRM": "1 Day View Support",
  "1DTRVS": "1 Day View Support Trial",
  "1MTR": "1 Month Trial",

  // --- 2 Week Pure family ---
  "2UWK": "2 Week Pure UP",
  "2UWKPRM": "2 Week Pure UP",
  "2UWKAT": "2 Week Pure UP Toric",
  "2UWT": "2 Week Pure UP Toric",
  "2WKUT": "2 Week Pure UP Toric",
  "2WMS": "2 Week Multistage",
  "2WMSPRM": "2 Week Multistage",
  "2WPT": "2 Week Pure Toric",
  "2WPTPRM": "2 Week Pure Toric",

  // --- Eye Coffret ---
  "EC10-M": "Eye Coffret-M",
  "EC10-MPRM": "Eye Coffret-M",
  "ECPRM": "Eye Coffret-M",
  "ECTR": "Eye Coffret Trial",
  "EC-MT": "Eye Coffret-M Toric",
  "ECRT10-M": "Eye Coffret 10 Toric",
  "ECWT10-M": "Eye Coffret 10 Toric",
  "ECRT30-M": "Eye Coffret 30 Toric",
  "ECWT30-M": "Eye Coffret 30 Toric",
  "ECRT30-MPRM": "Eye Coffret 30 Toric",
  "ECWT30-MPRM": "Eye Coffret 30 Toric",
  "ECRT-MT": "Eye Coffret Toric Trial",
  "ECWT-MT": "Eye Coffret Toric Trial",

  // --- Monthly Color UV ---
  "MCUV": "Monthly Color UV",
  "MCUPRM": "Monthly Color UV",
  "MCUVT": "Monthly Color UV Toric",
  "MCUV2": "Monthly Color UV II",
  "MCUV2T": "Monthly Color UV II Toric",
  "MCIIPRM": "Monthly Color UV II",
  "PRMMC": "Monthly Color UV",

  // --- Minasoft ---
  "MNSF10": "Minasoft 1Day Color",
  "MNSFPRM": "Minasoft 1Day Color",
  "MNSFTR": "Minasoft 1Day Color Trial",
  "MNSFCUV": "Minasoft Care UV",
  "MNSFCUVPRM": "Minasoft Care UV",
  "MNSFCUVTR": "Minasoft Care UV Trial",

  // --- Monthly Pure / Fine ---
  "MTPR": "Monthly Pure 6",
  "MTPRPRM": "Monthly Pure 6",
  "MTPRT": "Monthly Pure Toric",
  "MTPR3": "Monthly Pure 3",
  "MTPRPRM3": "Monthly Pure 3",
  "MFN+": "Monthly Fine Plus",
  "MHFPRM+": "Monthly Fine Plus",
  "MHFT+": "Monthly Fine Plus Toric",
  "MHFPRM": "Monthly Fine",
  "MHFT": "Monthly Fine Toric",

  // --- RGP / specialty / solutions (SEED "SD" codes) ---
  "SDEYEDROP": "DISOP Eyedrop",
  "SDRGPSL": "DISOP H2O2 Solution",
  "SDASL": "RGP AS-Luna / O2 Noah",
  "SDUV1": "RGP UV-1",
  "SDUV1KC": "RGP UV-1 KC",
  "SDIRIS": "Iris Lens",
  "SDBRHOC": "Breath-O-Correct",
  "SDBRHOCCSG": "Breath-O-Correct (Overseas)",
  "SDBRHOCCSG80": "Breath-O-Correct (Overseas)",
  "SDBRHOCCSG2025": "Breath-O-Correct (Overseas)",
  "SDBRHOCCSG2026": "Breath-O-Correct (Overseas)",
  "UVSCL": "Ultra Vision",
  "UVSPCL": "Ultra Vision Special",
  "WOHLKKE": "Wohlk KE RGP",
  "WOHLKLF": "Wohlk Life RGP",

  // --- Accessories, solutions, services ---
  "ACCSD": "Accessories (SEED)",
  "ACCOTH": "Accessories / Others",
  "CL": "Contact Lens (other)",
  "PRMSD": "Promo (SEED)",
  "SERVICE CHARGE": "Service Charge",
};

// A code is promotional/trial (zero-revenue giveaway) when it ends PRM/TR/TT or
// is a pure-promo bucket. Used to tag rows and optionally fold them into base.
export function isPromoOrTrial(code) {
  return /(?:PRM|TR|TT)\d*$/i.test(code || "") || /^PRM/i.test(code || "");
}

// Friendly label for a group code — falls back to the raw code so an unmapped
// code is visible (and fixable) rather than silently dropped.
export function groupLabel(code) {
  if (!code) return "—";
  return GROUP_LABELS[code] || GROUP_LABELS[String(code).trim()] || String(code).trim();
}
