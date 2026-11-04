import { LiveSession } from "@/components/join/LiveSession";

// MD-15 S06 frame. The participant cookie from the join says who this is.
export default async function LivePage({ params }: PageProps<"/s/[sessionId]">) {
  const { sessionId } = await params;
  return (
    <main className="flex h-dvh flex-col">
      <LiveSession sessionId={sessionId} />
    </main>
  );
}
