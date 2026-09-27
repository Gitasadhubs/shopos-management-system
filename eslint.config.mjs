import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts", "public/sw.js", "public/workbox-*.js"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "react-hooks/set-state-in-effect": "off",
      "@typescript-eslint/no-this-alias": "off",
    },
  },
];

export default eslintConfig;
