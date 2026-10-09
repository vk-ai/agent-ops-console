import { connection } from "next/server";
import { backends } from "@/lib/server/config";
import { errorResponse } from "@/lib/server/errors";

export async function GET() {
  await connection();
  try {
    return Response.json(await (await backends()).runtime.health());
  } catch (e) {
    return errorResponse(e);
  }
}
