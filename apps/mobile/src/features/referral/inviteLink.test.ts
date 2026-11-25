import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" }, Share: { share: vi.fn() } }));
const { APP_WEB_URL, inviteLink, shareInvite } = await import("./inviteLink");

afterEach(() => vi.unstubAllGlobals());

describe("inviteLink", () => {
  it("joins the code onto the site's origin, or the public site without one", () => {
    expect(inviteLink("abcd2345", "https://preview.example.app/")).toBe("https://preview.example.app/join/abcd2345");
    expect(inviteLink("abcd2345", null)).toBe(`${APP_WEB_URL}/join/abcd2345`);
  });
});

describe("shareInvite on web", () => {
  it("uses the share sheet when the browser has one, else the clipboard", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share });
    expect(await shareInvite("https://x/join/a", "join me")).toBe("shared");
    expect(share).toHaveBeenCalledWith({ text: "join me", url: "https://x/join/a" });

    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await shareInvite("https://x/join/a", "join me")).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("https://x/join/a");
  });

  it("a dismissed sheet is not a failure; a refused clipboard is", async () => {
    const abort = Object.assign(new Error("dismissed"), { name: "AbortError" });
    vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(abort) });
    expect(await shareInvite("u", "m")).toBe("shared");
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    expect(await shareInvite("u", "m")).toBe("failed");
  });
});
