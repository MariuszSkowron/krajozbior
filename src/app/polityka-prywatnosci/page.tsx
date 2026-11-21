import { LegalPage, legalMetadata } from "@/app/legal/legal-page";

export const metadata = legalMetadata("polityka-prywatnosci");

export default function PolitykaPrywatnosciPage() {
  return <LegalPage slug="polityka-prywatnosci" />;
}
