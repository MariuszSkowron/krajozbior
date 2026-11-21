import { LegalPage, legalMetadata } from "@/app/legal/legal-page";

export const metadata = legalMetadata("regulamin");

export default function RegulaminPage() {
  return <LegalPage slug="regulamin" />;
}
