// Web Push helper. Configures web-push with VAPID keys and fans a payload out
// to every stored subscription, pruning ones the push service reports as gone.
// All failures are swallowed so a tick never breaks because of push.

import webpush from "web-push";
import { query } from "@/lib/db";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

let configured = false;
function ensureConfigured() {
  if (configured) return PUBLIC_KEY && PRIVATE_KEY;
  if (PUBLIC_KEY && PRIVATE_KEY) {
    try {
      webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
      configured = true;
    } catch (err) {
      console.warn(`[push] VAPID config failed: ${err?.message}`);
    }
  }
  return configured;
}

export function getPublicKey() {
  return PUBLIC_KEY;
}

/** Persist (or refresh) a browser push subscription. */
export async function saveSubscription(sub) {
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!endpoint || !p256dh || !auth) return false;
  try {
    await query(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES ($1, $2, $3)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [endpoint, p256dh, auth]
    );
    return true;
  } catch (err) {
    console.warn(`[push] save failed: ${err?.message}`);
    return false;
  }
}

export async function removeSubscription(endpoint) {
  if (!endpoint) return;
  try {
    await query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
  } catch {
    /* ignore */
  }
}

/**
 * Send a notification payload to every subscriber. Expired subscriptions
 * (404/410) are pruned. Returns the number of successful sends.
 */
export async function sendPushToAll(payload) {
  if (!ensureConfigured()) return 0;

  let subs;
  try {
    ({ rows: subs } = await query("SELECT endpoint, p256dh, auth FROM push_subscriptions"));
  } catch (err) {
    console.warn(`[push] could not load subscriptions: ${err?.message}`);
    return 0;
  }

  const body = JSON.stringify(payload);
  let sent = 0;

  await Promise.all(
    subs.map(async (s) => {
      const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try {
        await webpush.sendNotification(subscription, body);
        sent += 1;
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await removeSubscription(s.endpoint);
        } else {
          console.warn(`[push] send failed (${err?.statusCode || "?"}): ${err?.message}`);
        }
      }
    })
  );

  return sent;
}
