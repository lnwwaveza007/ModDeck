import { AcceptCohostInvite } from "@/components/sessions/AcceptCohostInvite";

// Co-host invite link (F12). Accepts with the KMUTT login, then opens the co-host page.
export default async function CohostInvitePage({ params }: PageProps<"/cohost/[token]">) {
  const { token } = await params;
  return <AcceptCohostInvite token={token} />;
}
