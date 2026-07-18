import { NextResponse } from "next/server";
import { resolveProviderStatus } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await resolveProviderStatus();
  return NextResponse.json(status);
}
