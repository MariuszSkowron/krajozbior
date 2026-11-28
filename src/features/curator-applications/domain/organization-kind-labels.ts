import type { OrganizationKind } from "@/features/organizations/domain/organization";

// Names of the organization kinds as the applicant and the administrator read them (D-15). The
// kinds themselves are `ORGANIZATION_KINDS`; the labels exist only here.
export const ORGANIZATION_KIND_LABELS: Readonly<Record<OrganizationKind, string>> = {
  municipality: "Gmina",
  pttk: "Oddział PTTK",
  local_tourism_org: "Lokalna organizacja turystyczna (LOT)",
  regional_tourism_org: "Regionalna organizacja turystyczna (ROT)",
  person: "Przewodnik lub osoba prywatna",
  other: "Inna organizacja",
};
