import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ImportRunnerService } from "./import-runner.service";
import { ImportsController } from "./imports.controller";
import { ImportsService } from "./imports.service";

@Module({
  imports: [AuthModule],
  controllers: [ImportsController],
  providers: [ImportsService, ImportRunnerService],
})
export class ImportsModule {}
