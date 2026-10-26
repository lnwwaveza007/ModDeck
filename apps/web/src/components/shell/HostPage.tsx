import type { ReactNode } from "react";

/** Content column under the host header (MD-15 H01/H12): page title, then the page. */
export function HostPage({
  title,
  titleAs: Title = "h1",
  children,
}: {
  title: string;
  titleAs?: "h1" | "h2";
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-300 flex-1 flex-col gap-6 px-6 py-8">
      <Title className="text-3xl font-bold">{title}</Title>
      <div className="flex flex-1 flex-col rounded-xl border border-dashed border-neutral-300">
        {children}
      </div>
    </div>
  );
}
