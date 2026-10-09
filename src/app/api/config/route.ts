import { connection } from "next/server";
import { consoleConfig } from "@/lib/server/config";

export async function GET() {
  await connection();
  return Response.json(await consoleConfig());
}
