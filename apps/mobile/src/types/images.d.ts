/**
 * Image files imported by app code. Metro turns the import into an asset reference (a number, React Native's
 * `ImageRequireSource`), which expo-image accepts as `source`. Expo's own types declare no image modules.
 */
declare module "*.jpg" {
  const source: number;
  export default source;
}
