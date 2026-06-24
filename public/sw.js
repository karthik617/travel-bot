// Service worker for Elango push notifications. Receives a push payload and
// shows a desktop notification; focuses/opens the dashboard when clicked.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "🎒 Elango", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "🎒 Elango";
  const options = {
    body: data.body || "",
    tag: data.tag || "elango",
    icon: data.icon || undefined,
    badge: data.badge || undefined,
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    })
  );
});
