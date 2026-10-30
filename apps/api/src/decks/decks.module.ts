import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DecksController } from "./decks.controller";
import { DecksService } from "./decks.service";

@Module({
  imports: [AuthModule],
  controllers: [DecksController],
  providers: [DecksService],
})
export class DecksModule {}
