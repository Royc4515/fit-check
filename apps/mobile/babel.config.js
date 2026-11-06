module.exports = function (api) {
  api.cache(true);
  return {
    // jsxImportSource: nativewind lets className work on every RN primitive.
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
    // don't touch / the worklets plugin must be LAST or Reanimated 4 silently runs on the JS thread.
    plugins: ["react-native-worklets/plugin"],
  };
};
