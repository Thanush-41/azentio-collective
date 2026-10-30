import { z } from "zod";

// Fields copied into the shared representation come from these controlled lists only, never free text,
// so hidden metadata cannot leak through "offering", "region", "industry" or "period".
export const OFFERINGS = ["Financial Analysis Intelligence", "Lending Intelligence", "Compliance Intelligence"] as const;
export const INDUSTRIES = ["Banking", "Credit unions", "Insurance", "Fintech", "Capital markets", "Other financial services"] as const;
export const REGIONS = ["India", "South Asia", "South-East Asia", "Middle East", "Europe", "Africa", "Americas", "Global"] as const;
export const PERIOD_RE = /^\d{4}-(Q[1-4]|H[12])$/;

export const offeringField = z.enum(OFFERINGS);
export const industryField = z.enum(INDUSTRIES);
export const regionField = z.enum(REGIONS);
export const periodField = z.string().trim().regex(PERIOD_RE, "Use a quarter or half-year such as 2026-Q3");
