import { Platform, Share } from "react-native";

/** The public web address of the app: what a link shared from the phone app must open. */
export const APP_WEB_URL = "https://fit-check-il.vercel.app";

/** The page's own origin on web (a preview deploy shares itself); null on native. */
const webOrigin = (): string | null => (Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : null);

/** The invitation link for a referral code: /join/<code> on the site the user is on, or the public site. Pure. */
export function inviteLink(code: string, origin: string | null = webOrigin()): string {
  const base = (origin ?? APP_WEB_URL).replace(/\/+$/, "");
  return `${base}/join/${encodeURIComponent(code)}`;
}

/**
 * Hands the link to the system: the share sheet on a phone (native, or a mobile browser that has one), the clipboard
 * on a desktop browser. Never throws. "shared": the sheet showed (also when the user dismissed it, which is a
 * choice, not a failure); "copied": the screen says so; "failed": the link is on screen to copy by hand.
 */
export async function shareInvite(url: string, message: string): Promise<"shared" | "copied" | "failed"> {
  try {
    if (Platform.OS !== "web") {
      await Share.share({ message: `${message}\n${url}` });
      return "shared";
    }
    const nav = typeof navigator === "undefined" ? null : navigator;
    if (nav && typeof nav.share === "function") {
      await nav.share({ text: message, url });
      return "shared";
    }
    if (nav?.clipboard) {
      await nav.clipboard.writeText(url);
      return "copied";
    }
    return "failed";
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return "shared";
    return "failed";
  }
}
