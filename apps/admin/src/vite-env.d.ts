/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin, e.g. `http://localhost:3001` (public — shipped in the bundle). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
