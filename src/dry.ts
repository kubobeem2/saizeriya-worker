/**
 * Dry-run fetch source: the bundled mock Saizeriya server
 * (src/mock-server, vendored from the upstream repo's packages/server).
 * In dry mode the client core talks to this in-isolate mock instead of
 * the real official system, so no real order is ever placed. Unknown QR
 * URLs resolve to the mock's demo table, like they do in the mock's own
 * pages.
 */
import mockServer from './mock-server/main'

type FetchSource = (request: Request) => Promise<Response> | Response

export const dryFetch: FetchSource = (request) => mockServer.fetch(request)
