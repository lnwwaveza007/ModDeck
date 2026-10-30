import type { ReactNode } from "react";

/**
 * Content column under the host header (MD-15 H01/H12): page title with its actions, then the
 * page. Pages that are not built yet keep the dashed frame around their placeholder.
 */
export function HostPage({
  title,
  titleAs: Title = "h1",
  actions,
  framed = true,
  children,
}: {
  title: string;
  titleAs?: "h1" | "h2";
  actions?: ReactNode;
  framed?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-300 flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-center gap-4">
        <Title className="flex-1 text-3xl font-bold">{title}</Title>
        {actions}
      </div>
      {framed ? (
        <div className="flex flex-1 flex-col rounded-xl border border-dashed border-neutral-300">
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
