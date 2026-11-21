/** Why an operation was not done, in words a model can act on. */
export interface Refusal {
  ok: false;
  code:
    | "unknown-handle"
    | "gone"
    | "not-a-paragraph"
    | "no-match"
    | "several-matches"
    | "unknown-style"
    | "unknown-control"
    | "read-only"
    | "invalid"
    | "refused";
  message: string;
}

export type Ok<T = object> = { ok: true } & T;
export type Result<T = object> = Ok<T> | Refusal;

/** @internal */
export const refuse = (code: Refusal["code"], message: string): Refusal => ({
  ok: false,
  code,
  message,
});
