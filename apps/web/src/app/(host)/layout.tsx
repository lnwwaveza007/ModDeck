// Host side (desktop first). Each area adds its own header from MD-15:
// (nav) for My decks and history, SessionHeader for the editor, presenter and co-host tools.
export default function HostLayout({ children }: LayoutProps<"/">) {
  return <div className="flex min-h-screen flex-col bg-surface">{children}</div>;
}
