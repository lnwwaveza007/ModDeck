import { Fragment, useMemo } from "react";
import { cn } from "@/lib/cn";
import { parseRichText, type Inline } from "@/lib/render/rich-text";
import { CodeBlock } from "./CodeBlock";
import { MathBlock } from "./MathBlock";

function Inlines({ inlines }: { inlines: Inline[] }) {
  return inlines.map((inline, index) => {
    if (inline.type === "code") {
      return (
        <code
          key={index}
          className="rounded bg-neutral-100 px-[0.3em] py-[0.05em] font-mono text-[0.9em]"
        >
          {inline.value}
        </code>
      );
    }
    if (inline.type === "math") {
      return <MathBlock key={index} latex={inline.value} display={false} />;
    }
    return <Fragment key={index}>{inline.value}</Fragment>;
  });
}

/**
 * Text with `code`, fenced code, $math$ and $$display math$$ (F7, technical design §2.4). One
 * component for text slides, poll options and Q&A questions, so every screen shows the same.
 * Size comes from the parent's font size; blocks scale with it.
 */
export function RichText({ source, className }: { source: string; className?: string }) {
  const blocks = useMemo(() => parseRichText(source), [source]);

  return (
    <div className={cn("flex flex-col gap-[0.6em] break-words", className)}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading":
            return (
              <h2 key={index} className="text-[1.6em] leading-[1.25] font-bold">
                <Inlines inlines={block.inlines} />
              </h2>
            );
          case "paragraph":
            return (
              <p key={index} className="whitespace-pre-wrap">
                <Inlines inlines={block.inlines} />
              </p>
            );
          case "code":
            return (
              <CodeBlock
                key={index}
                source={block.value}
                language={block.language}
                className="text-[0.8em]"
              />
            );
          case "math":
            return <MathBlock key={index} latex={block.value} />;
        }
      })}
    </div>
  );
}
