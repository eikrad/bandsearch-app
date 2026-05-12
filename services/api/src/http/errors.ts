import type { Response } from "express";

export type ErrorPayload = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export function createErrorPayload(code: string, message: string, details?: unknown): ErrorPayload {
  const payload: ErrorPayload = {
    error: {
      code,
      message,
    },
  };

  if (details !== undefined) {
    payload.error.details = details;
  }

  return payload;
}

export function sendError(res: Response, status: number, code: string, message: string, details?: unknown) {
  return res.status(status).json(createErrorPayload(code, message, details));
}
