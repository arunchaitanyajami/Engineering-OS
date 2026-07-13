export type Brand<TValue, TBrand extends string> = TValue & {
  readonly __brand: TBrand;
};

export type Result<TValue, TError> =
  | {
      readonly ok: true;
      readonly value: TValue;
    }
  | {
      readonly ok: false;
      readonly error: TError;
    };

export const success = <TValue>(value: TValue): Result<TValue, never> => ({
  ok: true,
  value
});

export const failure = <TError>(error: TError): Result<never, TError> => ({
  ok: false,
  error
});

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const toIsoTimestamp = (value: Date = new Date()): string =>
  value.toISOString();
