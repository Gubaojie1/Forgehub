import { getChatGPTUser } from "./chatgpt-auth";
import { FirmwareHub } from "./FirmwareHub";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return <FirmwareHub displayName={user?.displayName ?? "研发同事"} />;
}
