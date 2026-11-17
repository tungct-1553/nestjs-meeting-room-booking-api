import { raw } from 'express';
import type { RequestHandler } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';

export const BODY_LIMIT_BYTES = 100 * 1024;
const payloadSize = Symbol('http:payloadSize');

interface PayloadRequest extends IncomingMessage {
  [payloadSize]?: number;
}

export function capturePayloadSize(
  request: IncomingMessage,
  _response: ServerResponse,
  body: Buffer,
): void {
  (request as PayloadRequest)[payloadSize] = body.length;
}

export function getPayloadSize(request: IncomingMessage): number | undefined {
  return (request as PayloadRequest)[payloadSize];
}

export function parsePayload(parser: RequestHandler): RequestHandler {
  return (request, response, next) => {
    parser(request, response, (error?: unknown) => {
      if (!(error instanceof Error)) {
        next(error);
        return;
      }

      // This boundary wraps trusted Express parsers, including their decompression errors.
      const status = (error as Error & { status?: unknown }).status;
      if (status === 413) {
        next(new PayloadTooLargeException('Request body exceeds allowed limits', { cause: error }));
        return;
      }
      if (status === 415) {
        next(
          new UnsupportedMediaTypeException('Unsupported request body encoding', { cause: error }),
        );
        return;
      }
      if (status === 400) {
        next(new BadRequestException('Invalid request body', { cause: error }));
        return;
      }
      next(error);
    });
  };
}

// Supported media types have already been consumed by the configured parsers.
// This fallback consumes unsupported payloads so the interceptor sees actual bytes.
const parseUnparsedPayload = parsePayload(
  raw({
    type: () => true,
    limit: BODY_LIMIT_BYTES,
    verify: capturePayloadSize,
  }),
);

export const captureUnparsedPayload: RequestHandler = (request, response, next) => {
  parseUnparsedPayload(request, response, (error?: unknown) => {
    if (!error && getPayloadSize(request) === undefined) {
      (request as PayloadRequest)[payloadSize] = 0;
    }
    next(error);
  });
};
