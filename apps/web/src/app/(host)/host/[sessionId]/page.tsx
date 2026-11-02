import { SessionLobby } from "@/components/shell/SessionLobby";

export default async function PresenterPage({ params }: PageProps<"/host/[sessionId]">) {
  const { sessionId } = await params;
  return <SessionLobby sessionId={sessionId} />;
}
