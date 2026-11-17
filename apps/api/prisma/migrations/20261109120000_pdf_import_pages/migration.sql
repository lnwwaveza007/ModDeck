-- PDF import (F9): the import row is the queue, one row per page links a PDF page to its slide.
ALTER TABLE "pdf_imports" ADD COLUMN "file_ref" TEXT;
ALTER TABLE "pdf_imports" ADD COLUMN "error_code" TEXT;
CREATE INDEX "pdf_imports_status_created_at_idx" ON "pdf_imports"("status", "created_at");

-- Text of the imported page, Thai repair applied (kept for the Release 2 AI features).
ALTER TABLE "slides" ADD COLUMN "source_text" TEXT;

CREATE TABLE "pdf_import_pages" (
    "import_id" UUID NOT NULL,
    "page" INTEGER NOT NULL,
    "slide_id" UUID NOT NULL,
    "status" "import_status" NOT NULL DEFAULT 'queued',
    "error_code" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pdf_import_pages_pkey" PRIMARY KEY ("import_id","page")
);

CREATE UNIQUE INDEX "pdf_import_pages_slide_id_key" ON "pdf_import_pages"("slide_id");

ALTER TABLE "pdf_import_pages" ADD CONSTRAINT "pdf_import_pages_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "pdf_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pdf_import_pages" ADD CONSTRAINT "pdf_import_pages_slide_id_fkey" FOREIGN KEY ("slide_id") REFERENCES "slides"("id") ON DELETE CASCADE ON UPDATE CASCADE;
