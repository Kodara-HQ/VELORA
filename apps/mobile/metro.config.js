// Expo's default config detects the npm workspace (monorepo) and watches the shared package.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
