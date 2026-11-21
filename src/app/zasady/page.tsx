import { LegalPage, legalMetadata } from "@/app/legal/legal-page";

export const metadata = legalMetadata("zasady");

export default function ZasadyPage() {
  return <LegalPage slug="zasady" />;
}
