export interface ApplicationError {
  readonly code: string;
  readonly message: string;
  readonly userMessage: string;
  readonly recoverable: boolean;
  readonly cause?: unknown;
  readonly metadata?: Record<string, unknown>;
}

export const createApplicationError = (
  error: Partial<ApplicationError> & Pick<ApplicationError, "code" | "message">
): ApplicationError => ({
  userMessage: "Engineering OS could not complete that action.",
  recoverable: true,
  ...error
});

export const normalizeApplicationError = (
  error: unknown,
  fallback: Partial<ApplicationError> = {}
): ApplicationError => {
  if (typeof error === "object" && error !== null && "code" in error) {
    const candidate = error as Partial<ApplicationError>;

    return createApplicationError({
      code: candidate.code ?? fallback.code ?? "UNKNOWN_ERROR",
      message: candidate.message ?? fallback.message ?? "Unknown application error.",
      userMessage:
        candidate.userMessage ??
        fallback.userMessage ??
        "Engineering OS hit an unexpected error.",
      recoverable: candidate.recoverable ?? fallback.recoverable ?? true,
      ...(candidate.cause ?? fallback.cause
        ? { cause: candidate.cause ?? fallback.cause }
        : {}),
      ...(candidate.metadata ?? fallback.metadata
        ? { metadata: candidate.metadata ?? fallback.metadata }
        : {})
    });
  }

  if (error instanceof Error) {
    return createApplicationError({
      code: fallback.code ?? "UNEXPECTED_EXCEPTION",
      message: error.message,
      userMessage:
        fallback.userMessage ??
        "Engineering OS hit an unexpected error while starting.",
      recoverable: fallback.recoverable ?? true,
      cause: error,
      ...(fallback.metadata ? { metadata: fallback.metadata } : {})
    });
  }

  return createApplicationError({
    code: fallback.code ?? "UNKNOWN_ERROR",
    message: fallback.message ?? "Unknown application error.",
    userMessage:
      fallback.userMessage ??
      "Engineering OS hit an unexpected error while starting.",
    recoverable: fallback.recoverable ?? true,
    cause: error,
    ...(fallback.metadata ? { metadata: fallback.metadata } : {})
  });
};
