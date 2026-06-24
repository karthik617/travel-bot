import { NextResponse } from "next/server";
import { getPublicKey, saveSubscription, removeSubscription } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET → the VAPID public key the browser needs to subscribe. */
export async function GET() {
  return NextResponse.json({ ok: true, publicKey: getPublicKey() });
}

/** POST → store a push subscription. */
export async function POST(request) {
  try {
    const sub = await request.json();
    const ok = await saveSubscription(sub);
    return NextResponse.json({ ok });
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid subscription" }, { status: 400 });
  }
}

/** DELETE → remove a subscription by endpoint. */
export async function DELETE(request) {
  try {
    const { endpoint } = await request.json();
    await removeSubscription(endpoint);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
