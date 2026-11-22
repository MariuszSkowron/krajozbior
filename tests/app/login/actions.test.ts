import { beforeEach, describe, expect, it, vi } from "vitest";

// "Zmień adres" (D-49): forgets the address kept between the two steps and goes back to step 1.
const mocks = vi.hoisted(() => ({
  deleteCookie: vi.fn(),
  redirect: vi.fn((location: string) => {
    throw new Error(`NEXT_REDIRECT:${location}`);
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ delete: mocks.deleteCookie }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const { changeLoginAddress } = await import("@/app/login/actions");

async function change(returnTo?: string): Promise<string> {
  const form = new FormData();

  if (returnTo !== undefined) {
    form.set("returnTo", returnTo);
  }

  await expect(changeLoginAddress(form)).rejects.toThrow(/^NEXT_REDIRECT:/);

  return mocks.redirect.mock.calls.at(-1)?.[0] ?? "";
}

beforeEach(() => {
  mocks.deleteCookie.mockReset();
  mocks.redirect.mockClear();
});

describe("changeLoginAddress", () => {
  it("deletes the address cookie of the login path and goes back to step 1", async () => {
    expect(await change()).toBe("/login");
    expect(mocks.deleteCookie).toHaveBeenCalledWith({
      name: "krajozbior_login_email",
      path: "/login",
    });
  });

  it("keeps a same-site returnTo", async () => {
    expect(await change("/my")).toBe("/login?returnTo=%2Fmy");
  });

  it("never follows an external returnTo (it falls back to the site root)", async () => {
    expect(await change("//evil.example")).toBe("/login?returnTo=%2F");
    expect(await change("https://evil.example/x")).toBe("/login?returnTo=%2F");
    expect(mocks.deleteCookie).toHaveBeenCalledTimes(2);
  });
});
