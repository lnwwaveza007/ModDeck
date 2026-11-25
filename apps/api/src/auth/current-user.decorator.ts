import { ExecutionContext, createParamDecorator } from "@nestjs/common";
import type { AuthUser, AuthedRequest } from "./auth.types";

/** Use behind AuthGuard: `@CurrentUser() user: AuthUser`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<AuthedRequest>().user,
);

/**
 * Use behind AuthGuard: the account that signed in. While an admin impersonates, this is the
 * admin and `@CurrentUser()` is the impersonated user.
 */
export const SignedInUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    return req.impersonator ?? req.user;
  },
);
