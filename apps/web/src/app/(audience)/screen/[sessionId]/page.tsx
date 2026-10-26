import { PagePlaceholder } from "@/components/shell/PagePlaceholder";

// MD-15 P01–P07: a 16:9 white stage, centred and letterboxed on any projector.
export default function ScreenPage() {
  return (
    <div className="grid flex-1 place-items-center bg-neutral-900">
      <div className="flex aspect-video max-h-screen w-full max-w-[calc(100vh*16/9)] flex-col bg-background">
        <PagePlaceholder page="screen" />
      </div>
    </div>
  );
}
