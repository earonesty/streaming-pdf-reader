export type PdfErrorCode = "INVALID_PDF" | "UNSUPPORTED_FEATURE" | "RESOURCE_LIMIT";

export class PdfError extends Error {
  readonly code: PdfErrorCode;

  constructor(code: PdfErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PdfError";
    this.code = code;
  }
}

export function normalizePdfError(error: unknown): Error {
  if (error instanceof PdfError || error instanceof RangeError) return error;
  const cause = error instanceof Error ? error : undefined;
  const message = cause?.message ?? String(error);
  const code = /configured limit|exceeds configured|max(?:imum)? .*bytes/i.test(message)
    ? "RESOURCE_LIMIT"
    : "INVALID_PDF";
  return new PdfError(code, message, cause ? { cause } : undefined);
}
