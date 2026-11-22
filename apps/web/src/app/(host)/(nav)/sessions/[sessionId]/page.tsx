import { SessionResultsView } from "@/components/sessions/SessionResultsView";

// F10 Session results. Ending a session lands here from presenter control.
export default async function SessionResultsPage({ params }: PageProps<"/sessions/[sessionId]">) {
  const { sessionId } = await params;
  return <SessionResultsView sessionId={sessionId} />;
}
