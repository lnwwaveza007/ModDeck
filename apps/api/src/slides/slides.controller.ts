import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  SLIDE_IMAGE_MAX_BYTES,
  slideCreateBodySchema,
  slideOrderBodySchema,
  slidePatchBodySchema,
  type SlideCreateBody,
  type SlideDto,
  type SlideOrderBody,
  type SlidePatchBody,
} from "@moddeck/shared";
import type { Response } from "express";
import { API_PREFIX } from "../auth/auth.config";
import { AuthGuard } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { ApiException, ZodBody } from "../common/api-error";
import { SlideImagesService } from "./slide-images.service";
import { SlidesService } from "./slides.service";

// Slides of one deck (technical design §3.3). Every route is scoped to the deck's owner.
@Controller("decks/:deckId")
@UseGuards(AuthGuard)
export class SlidesController {
  constructor(
    private readonly slides: SlidesService,
    private readonly images: SlideImagesService,
  ) {}

  @Post("slides")
  async create(
    @CurrentUser() user: AuthUser,
    @Param("deckId") deckId: string,
    @Body(new ZodBody(slideCreateBodySchema)) body: SlideCreateBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SlideDto> {
    const slide = await this.slides.create(user.id, deckId, body);
    res.location(`/${API_PREFIX}/decks/${deckId}/slides/${slide.id}`);
    return slide;
  }

  @Patch("slides/:slideId")
  update(
    @CurrentUser() user: AuthUser,
    @Param("deckId") deckId: string,
    @Param("slideId") slideId: string,
    @Body(new ZodBody(slidePatchBodySchema)) body: SlidePatchBody,
  ): Promise<SlideDto> {
    return this.slides.update(user.id, deckId, slideId, body);
  }

  @Delete("slides/:slideId")
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param("deckId") deckId: string,
    @Param("slideId") slideId: string,
  ): Promise<void> {
    return this.slides.remove(user.id, deckId, slideId);
  }

  @Post("slides/:slideId/copies")
  async duplicate(
    @CurrentUser() user: AuthUser,
    @Param("deckId") deckId: string,
    @Param("slideId") slideId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SlideDto> {
    const slide = await this.slides.duplicate(user.id, deckId, slideId);
    res.location(`/${API_PREFIX}/decks/${deckId}/slides/${slide.id}`);
    return slide;
  }

  @Put("slide-order")
  reorder(
    @CurrentUser() user: AuthUser,
    @Param("deckId") deckId: string,
    @Body(new ZodBody(slideOrderBodySchema)) body: SlideOrderBody,
  ): Promise<SlideDto[]> {
    return this.slides.reorder(user.id, deckId, body.slideIds);
  }

  // multipart/form-data with one `file` field.
  @Put("slides/:slideId/image")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: SLIDE_IMAGE_MAX_BYTES } }))
  async uploadImage(
    @CurrentUser() user: AuthUser,
    @Param("deckId") deckId: string,
    @Param("slideId") slideId: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ): Promise<SlideDto> {
    await this.slides.assertImageSlide(user.id, deckId, slideId);
    if (!file) throw new ApiException(422, "INVALID_PAYLOAD", "Send the image in a `file` field");
    const imageRef = await this.images.save(file.buffer);
    return this.slides.setImage(user.id, deckId, slideId, imageRef);
  }
}

// Slide images are read by the projector and by students, who have no host login. The file
// name is a random uuid, so only someone who was shown the slide can ask for it.
@Controller("slide-images")
export class SlideImagesController {
  constructor(private readonly images: SlideImagesService) {}

  @Get(":imageRef")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  @Header("X-Content-Type-Options", "nosniff")
  async read(@Param("imageRef") imageRef: string): Promise<StreamableFile> {
    const { stream, type, length } = await this.images.open(imageRef);
    return new StreamableFile(stream as never, { type, length });
  }
}
