import { Button } from "./ui";

/**
 * Compatibility wrapper: the library `Button` text variant under the old name, so screens not yet moved to the
 * library look identical to ones that are. New code uses `Button variant="text"` directly.
 * `quiet` is accepted and ignored: the library has one text-button look, and a second tone would be a one-off.
 */
export function TextAction({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean; quiet?: boolean }) {
  return <Button variant="text" label={label} onPress={onPress} disabled={disabled} />;
}
