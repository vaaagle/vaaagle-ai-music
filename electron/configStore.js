const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const defaultConfigPath = path.join(__dirname, "..", "config", "defaults.json");

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function deepMerge(base, override) {
  const result = { ...base };
  Object.keys(override || {}).forEach((key) => {
    const baseValue = result[key];
    const overrideValue = override[key];
    if (
      baseValue &&
      overrideValue &&
      typeof baseValue === "object" &&
      typeof overrideValue === "object" &&
      !Array.isArray(baseValue) &&
      !Array.isArray(overrideValue)
    ) {
      result[key] = deepMerge(baseValue, overrideValue);
    } else {
      result[key] = overrideValue;
    }
  });
  return result;
}

function getUserConfigPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function ensureConfigFile() {
  const userConfigPath = getUserConfigPath();
  const userDir = path.dirname(userConfigPath);
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  if (!fs.existsSync(userConfigPath)) {
    const defaults = readJson(defaultConfigPath) || {};
    fs.writeFileSync(userConfigPath, JSON.stringify(defaults, null, 2), "utf-8");
  }
  return userConfigPath;
}

function getConfig() {
  const defaults = readJson(defaultConfigPath) || {};
  const userConfigPath = ensureConfigFile();
  const userConfig = readJson(userConfigPath) || {};
  return deepMerge(defaults, userConfig);
}

function saveConfig(nextConfig) {
  const defaults = readJson(defaultConfigPath) || {};
  const merged = deepMerge(defaults, nextConfig || {});
  const userConfigPath = ensureConfigFile();
  fs.writeFileSync(userConfigPath, JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

module.exports = {
  getConfig,
  saveConfig,
  getUserConfigPath
};
