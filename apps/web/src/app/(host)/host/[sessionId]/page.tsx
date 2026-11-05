import { PresenterControl } from "@/components/presenter/PresenterControl";

export default async function PresenterPage({ params }: PageProps<"/host/[sessionId]">) {
  const { sessionId } = await params;
  return <PresenterControl sessionId={sessionId} />;
}
