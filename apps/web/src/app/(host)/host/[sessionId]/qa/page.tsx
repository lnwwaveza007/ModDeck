import { PresenterControl } from "@/components/presenter/PresenterControl";

// MD-15 H11 co-host page: Q&A moderation and the participant list, with "Take over this session".
export default async function CohostQaPage({ params }: PageProps<"/host/[sessionId]/qa">) {
  const { sessionId } = await params;
  return <PresenterControl sessionId={sessionId} mode="moderation" />;
}
