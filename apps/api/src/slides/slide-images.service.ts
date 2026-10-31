import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { SLIDE_IMAGE_MAX_BYTES, type SlideImageType } from "@moddeck/shared";
import { ApiException } from "../common/api-error";

const EXTENSIONS: Record<SlideImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const MIME_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSIONS).map(([mime, extension]) => [extension, mime]),
);

// Names the api writes: a uuid and one known extension. Nothing else is read back, so a
// request cannot walk out of the slides folder.
export const IMAGE_REF_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|gif)$/;

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

/** The type from the file's first bytes. The upload's own content type is not trusted. */
export function sniffImageType(bytes: Buffer): SlideImageType | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6))) {
    return "image/gif";
  }
  return null;
}

/**
 * Slide images in the `slides` volume (technical design §1). Files are written once and never
 * edited, so a duplicated slide or deck shares the same file.
 */
@Injectable()
export class SlideImagesService {
  private readonly dir = process.env.SLIDES_DIR ?? join(process.cwd(), "data", "slides");

  async save(bytes: Buffer): Promise<string> {
    if (bytes.length === 0) {
      throw new ApiException(422, "INVALID_PAYLOAD", "Image file is missing or empty");
    }
    if (bytes.length > SLIDE_IMAGE_MAX_BYTES) {
      throw new ApiException(413, "INVALID_PAYLOAD", "Image is larger than 5 MB");
    }
    const type = sniffImageType(bytes);
    if (!type) {
      throw new ApiException(415, "INVALID_PAYLOAD", "Image must be PNG, JPEG, WebP or GIF");
    }
    const ref = `${randomUUID()}.${EXTENSIONS[type]}`;
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, ref), bytes, { flag: "wx" });
    return ref;
  }

  async open(
    ref: string,
  ): Promise<{ stream: NodeJS.ReadableStream; type: string; length: number }> {
    const notFound = () => new ApiException(404, "NOT_FOUND", "Image not found");
    if (!IMAGE_REF_PATTERN.test(ref)) throw notFound();
    const path = join(this.dir, ref);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw notFound();
    return {
      stream: createReadStream(path),
      type: MIME_BY_EXTENSION[ref.slice(ref.lastIndexOf(".") + 1)],
      length: info.size,
    };
  }
}
