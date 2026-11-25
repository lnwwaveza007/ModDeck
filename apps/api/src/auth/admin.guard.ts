import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { ApiException } from "../common/api-error";
import { AuthService } from "./auth.service";
import type { AuthedRequest } from "./auth.types";

/**
 * Use after AuthGuard: `@UseGuards(AuthGuard, AdminGuard)`. Checks the signed-in account (the
 * admin, also while impersonating) against ADMIN_EMAILS. Others get 403 ADMIN_ONLY.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const signedIn = req.impersonator ?? req.user;
    if (!signedIn || !this.auth.isAdmin(signedIn)) {
      throw new ApiException(403, "ADMIN_ONLY", "Only admins can do this");
    }
    return true;
  }
}
