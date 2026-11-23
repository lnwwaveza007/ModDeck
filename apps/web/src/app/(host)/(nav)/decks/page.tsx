import { DeckList } from "@/components/decks/DeckList";
import { CohostInvites } from "@/components/sessions/CohostInvites";

// MD-15 H01. The list loads in the browser, where the host_session cookie is. Co-host invites sent
// to this account by email show above it.
export default function DecksPage() {
  return (
    <>
      <CohostInvites />
      <DeckList />
    </>
  );
}
