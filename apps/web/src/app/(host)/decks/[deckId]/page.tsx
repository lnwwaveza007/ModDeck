import { DeckEditor } from "@/components/editor/DeckEditor";

// MD-15 H02 deck editor. The header, slide list, canvas and side panel live in DeckEditor,
// because they all need the deck once it has loaded.
export default async function DeckEditorPage({ params }: PageProps<"/decks/[deckId]">) {
  const { deckId } = await params;
  return <DeckEditor deckId={deckId} />;
}
