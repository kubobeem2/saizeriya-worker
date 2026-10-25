/**
 * Minimal Bun ambient declaration so the bundled mock server
 * (packages/server, written for Bun) typechecks in this package.
 * The Bun.file code path serves the mock's own debug assets and is never
 * exercised by the dry-run ordering flow.
 */
declare const Bun: {
  file: (path: unknown) => {
    exists: () => Promise<boolean>
    text: () => Promise<string>
    stream: () => ReadableStream
    type: string
  }
}
