/* Firebase Messaging service worker for Northstone CRM PWA notifications. */
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

(async function boot() {
  try {
    const url = new URL(self.location.href);
    const apiKey = url.searchParams.get("apiKey");
    const authDomain = url.searchParams.get("authDomain");
    const projectId = url.searchParams.get("projectId");
    const messagingSenderId = url.searchParams.get("messagingSenderId");
    const appId = url.searchParams.get("appId");
    if (!apiKey || !projectId || !messagingSenderId || !appId) {
      return;
    }
    firebase.initializeApp({
      apiKey,
      authDomain: authDomain || undefined,
      projectId,
      messagingSenderId,
      appId,
    });
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const notificationTitle = payload.notification?.title || "Northstone update";
      const notificationOptions = {
        body: payload.notification?.body || "You have a new CRM notification.",
        icon: "/northstone-logo-icon.png",
        data: payload.data || {},
      };
      self.registration.showNotification(notificationTitle, notificationOptions);
    });
  } catch {
    // Keep the worker resilient even when Firebase config is incomplete.
  }
})();
