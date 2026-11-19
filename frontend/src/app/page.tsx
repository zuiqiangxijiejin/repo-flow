import { redirect } from "next/navigation";

import { env } from "@/env";

export default function HomePage() {
  redirect(
    env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"
      ? "/workspace/chats"
      : "/workspace/chats/new",
  );
}
