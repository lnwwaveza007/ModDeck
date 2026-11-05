import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { SlideImagesService } from "./slide-images.service";
import { SlideImagesController, SlidesController } from "./slides.controller";
import { SlidesService } from "./slides.service";

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [SlidesController, SlideImagesController],
  providers: [SlidesService, SlideImagesService],
})
export class SlidesModule {}
