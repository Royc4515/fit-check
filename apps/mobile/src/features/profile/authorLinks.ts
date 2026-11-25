/**
 * Roy's public pages, the exact addresses he gave (2026-11-25), in the order a recruiter reads them. The one list the
 * sign-in and profile credits read, so they cannot drift apart again. Kept out of the component so a test can pin
 * the addresses without React Native.
 */
export const AUTHOR_LINKS = [
  { key: "portfolio", href: "https://roy-carmelli-portfolio.vercel.app/" },
  { key: "linkedin", href: "https://www.linkedin.com/in/roy-carmelli" },
  { key: "github", href: "https://github.com/Royc4515" },
] as const;
