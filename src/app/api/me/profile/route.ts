import { handleProfileSave } from "@/features/profile/http/profile-http";

export const dynamic = "force-dynamic";

// Saves the profile of the signed-in explorer (E9-2): first name, the first
// letter of the family name, region and visibility. The body names no owner:
// the profile is always the one of the session. PUT takes JSON; POST takes the
// native form of the settings screen and redirects back to it.
export async function PUT(request: Request) {
  return handleProfileSave(request);
}

export async function POST(request: Request) {
  return handleProfileSave(request);
}
