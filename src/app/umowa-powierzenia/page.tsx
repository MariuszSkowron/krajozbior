import { LegalPage, legalMetadata } from "@/app/legal/legal-page";

export const metadata = legalMetadata("umowa-powierzenia");

export default function UmowaPowierzeniaPage() {
  return <LegalPage slug="umowa-powierzenia" />;
}
