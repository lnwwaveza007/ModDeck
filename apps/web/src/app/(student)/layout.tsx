// Student side: mobile first, one narrow column. Each screen brings its MD-15 header,
// and every one of them keeps the language switch in reach (MD-5 §2.7).
export default function StudentLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background">
      {children}
    </div>
  );
}
