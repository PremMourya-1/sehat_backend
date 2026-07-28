module.exports = {
  root: true,
  env: {
    node: true,
    commonjs: true,
    es2021: true,
  },
  extends: ["eslint:recommended"],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "script",
  },
  rules: {
    "no-unused-vars": ["warn", { args: "none" }],
    "no-console": "off",
  },
  ignorePatterns: ["node_modules/", "uploads/"],
};
