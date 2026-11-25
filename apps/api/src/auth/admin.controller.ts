import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { UserSummary } from "@moddeck/shared";
import { AdminGuard } from "./admin.guard";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";

// Admin tools. Only accounts on ADMIN_EMAILS get past AdminGuard.
@Controller("admin")
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly auth: AuthService) {}

  // The impersonate picker: users whose email or name contains `q`.
  @Get("users")
  users(@Query("q") q: unknown): Promise<UserSummary[]> {
    return this.auth.searchUsers(typeof q === "string" ? q.slice(0, 254) : "");
  }
}
