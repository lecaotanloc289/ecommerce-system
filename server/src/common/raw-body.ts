import { Readable } from 'node:stream';
import { errorCodes, type FastifyInstance } from 'fastify';

/**
 * Keeps the exact request body bytes on `request.rawBody` for routes declaring
 * `@RouteConfig({ rawBody: true })` (webhooks that verify a signature / hash over the body as
 * received). Implemented as a `preParsing` hook that buffers the payload and hands the parser an
 * identical stream, so the content-type parsers (Nest's JSON parser included) stay untouched and
 * every other route parses exactly as before, without keeping a raw copy.
 *
 * Call once on the root instance before the app is initialised (main.ts and HTTP tests).
 */
export function registerRawBodyCapture(fastify: FastifyInstance): void {
  fastify.addHook('preParsing', async (request, _reply, payload) => {
    if (request.routeOptions.config?.rawBody !== true) return payload;

    // These routes are unauthenticated until verified: enforce the body limit while buffering.
    const limit = request.routeOptions.bodyLimit;
    if (Number(request.headers['content-length']) > limit) {
      throw new errorCodes.FST_ERR_CTP_BODY_TOO_LARGE();
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of payload) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.length;
      if (size > limit) throw new errorCodes.FST_ERR_CTP_BODY_TOO_LARGE();
      chunks.push(buffer);
    }
    const rawBody = Buffer.concat(chunks);
    request.rawBody = rawBody;
    return Readable.from([rawBody], { objectMode: false });
  });
}
