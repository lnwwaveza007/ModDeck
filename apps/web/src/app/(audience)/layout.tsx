// Projector output: full screen, no chrome, display only (MD-5 §3.3).
export default function AudienceLayout({ children }: LayoutProps<"/">) {
  return <main className="flex h-screen flex-col overflow-hidden bg-background">{children}</main>;
}
