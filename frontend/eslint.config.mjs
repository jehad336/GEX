import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

/** Flat config: eslint-config-next v16 exports flat configs directly. */
export default [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...(Array.isArray(coreWebVitals) ? coreWebVitals : [coreWebVitals]),
  ...(Array.isArray(typescript) ? typescript : [typescript]),
];
