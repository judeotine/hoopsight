import { NextRequest, NextResponse } from "next/server";
import { analyzeBooking } from "@/lib/betpawa";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")?.trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: "Pass a booking code" }, { status: 400 });
  }
  try {
    const result = await analyzeBooking(code);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
