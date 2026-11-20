import { PublicPrototypeView } from "@/app/PublicPrototypeView";
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <main style={{ padding: 24 }}><PublicPrototypeView token={token} /></main>;
}
