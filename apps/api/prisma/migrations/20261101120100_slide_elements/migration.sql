-- AlterTable
ALTER TABLE "slides" ADD COLUMN "elements" JSONB NOT NULL DEFAULT '[]';

-- Turn the old one-thing-per-slide kinds into canvas slides. Positions are percent of the 16:9
-- stage and sizes match the old fixed layouts.
UPDATE "slides" SET
  "elements" = CASE "kind"
    WHEN 'text' THEN CASE
      WHEN "content" IS NULL OR "content" = '' THEN '[]'::jsonb
      ELSE jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text, 'type', 'text', 'x', 8, 'y', 8, 'w', 84,
        'text', "content", 'size', 3.4, 'bold', false, 'align', 'left'))
    END
    WHEN 'code' THEN CASE
      WHEN "content" IS NULL OR "content" = '' THEN '[]'::jsonb
      ELSE jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text, 'type', 'code', 'x', 5, 'y', 8, 'w', 90,
        'code', "content", 'language', 'python', 'size', 2.2))
    END
    WHEN 'math' THEN CASE
      WHEN "content" IS NULL OR "content" = '' THEN '[]'::jsonb
      ELSE jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text, 'type', 'math', 'x', 8, 'y', 35, 'w', 84,
        'latex', "content", 'size', 4.8, 'align', 'center'))
    END
    WHEN 'image' THEN CASE
      WHEN "image_ref" IS NULL THEN '[]'::jsonb
      ELSE jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text, 'type', 'image', 'x', 0, 'y', 0, 'w', 100, 'h', 100,
        'imageRef', "image_ref"))
    END
  END,
  "kind" = 'content'
WHERE "kind" IN ('text', 'code', 'math', 'image');
