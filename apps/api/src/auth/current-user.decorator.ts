import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthUser, AuthedRequest } from './auth.types';

/** Use behind AuthGuard: `@CurrentUser() user: AuthUser`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<AuthedRequest>().user,
);
