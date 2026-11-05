import { AudienceScreen } from "@/components/presenter/AudienceScreen";

// MD-15 P01–P07: a 16:9 stage, centred and letterboxed on any projector.
export default async function ScreenPage({ params }: PageProps<"/screen/[sessionId]">) {
  const { sessionId } = await params;
  return <AudienceScreen sessionId={sessionId} />;
}
