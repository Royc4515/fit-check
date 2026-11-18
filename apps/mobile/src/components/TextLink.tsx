import { useRouter, type Href } from "expo-router";
import { Button } from "./ui";

/**
 * Compatibility wrapper: a library text `Button` that navigates to `href`. Navigation goes through the router rather
 * than a `Link`, because Button owns its own press handling and focus ring.
 */
export function TextLink({ href, label }: { href: Href; label: string }) {
  const router = useRouter();
  return <Button variant="text" label={label} onPress={() => router.push(href)} />;
}
