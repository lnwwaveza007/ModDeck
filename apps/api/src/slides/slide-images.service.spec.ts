import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SLIDE_IMAGE_MAX_BYTES } from "@moddeck/shared";
import { IMAGE_REF_PATTERN, SlideImagesService, sniffImageType } from "./slide-images.service";

const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(16)]);
const JPEG = Buffer.from("ffd8ffe000104a464946", "hex");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00", "binary");

describe("sniffImageType", () => {
  it("reads the type from the first bytes", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(WEBP)).toBe("image/webp");
    expect(sniffImageType(GIF)).toBe("image/gif");
  });

  it("refuses SVG, HTML and short files", () => {
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImageType(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImageType(Buffer.from("GIF"))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe("SlideImagesService", () => {
  let dir: string;
  let service: SlideImagesService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "moddeck-slides-"));
    process.env.SLIDES_DIR = dir;
    service = new SlideImagesService();
  });

  afterEach(async () => {
    delete process.env.SLIDES_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  it("stores an image under a random uuid name and reads it back", async () => {
    const ref = await service.save(PNG);
    expect(ref).toMatch(IMAGE_REF_PATTERN);
    expect(ref.endsWith(".png")).toBe(true);
    expect(await readdir(dir)).toEqual([ref]);

    const { type, length } = await service.open(ref);
    expect(type).toBe("image/png");
    expect(length).toBe(PNG.length);
  });

  it("rejects empty, oversized and non-image files", async () => {
    await expect(service.save(Buffer.alloc(0))).rejects.toMatchObject({ status: 422 });
    await expect(service.save(Buffer.alloc(SLIDE_IMAGE_MAX_BYTES + 1))).rejects.toMatchObject({
      status: 413,
    });
    await expect(service.save(Buffer.from("not an image"))).rejects.toMatchObject({ status: 415 });
    expect(await readdir(dir)).toEqual([]);
  });

  it("answers 404 for a missing file or a name that is not one of ours", async () => {
    await expect(service.open("0192f3a4-0000-7000-8000-000000000001.png")).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.open("../../etc/passwd")).rejects.toMatchObject({ status: 404 });
    await expect(service.open("..%2f..%2fsecret.png")).rejects.toMatchObject({ status: 404 });
  });
});
