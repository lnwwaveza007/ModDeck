import { HttpException, PipeTransform } from "@nestjs/common";
import type { ErrorCode } from "@moddeck/shared";
import type { ZodType } from "zod";

/** REST error in the shared body (technical design §3.5): `{ error: { code, message } }`. */
export class ApiException extends HttpException {
  constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super({ error: { code, message, ...(details ? { details } : {}) } }, status);
  }
}

/** `@Body(new ZodBody(schema))`: 422 INVALID_PAYLOAD with the zod issues when the body fails. */
export class ZodBody<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new ApiException(422, "INVALID_PAYLOAD", "Invalid request body", {
        issues: parsed.error.issues.map(({ path, code }) => ({ path: path.join("."), code })),
      });
    }
    return parsed.data;
  }
}
