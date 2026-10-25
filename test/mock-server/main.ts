// The mock server now lives in src/mock-server (it is bundled into the
// Worker for dry-run mode). This re-export keeps the test import path.
export { default } from '../../src/mock-server/main'
export * from '../../src/mock-server/main'
