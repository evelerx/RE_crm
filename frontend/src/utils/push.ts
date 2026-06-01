import { initializeApp } from "firebase/app";
import { getMessaging, getToken, isSupported, onMessage, type MessagePayload } from "firebase/messaging";

import { getFirebaseWebConfig, subscribePush } from "../api/client";

let foregroundListenerAttached = false;

function buildWorkerQuery(config: {
  apiKey: string;
  authDomain: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
}) {
  const query = new URLSearchParams();
  query.set("apiKey", config.apiKey);
  query.set("authDomain", config.authDomain);
  query.set("projectId", config.projectId);
  query.set("messagingSenderId", config.messagingSenderId);
  query.set("appId", config.appId);
  return query.toString();
}

export async function initPushNotifications(onToast?: (title: string, body: string) => void) {
  if (!(typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator)) {
    return null;
  }
  if (!(await isSupported())) {
    return null;
  }
  const config = await getFirebaseWebConfig();
  if (!config.configured || !config.vapidKey) {
    return null;
  }
  if (Notification.permission === "denied") {
    return null;
  }

  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") {
    return null;
  }

  const app = initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
  });
  const registration = await navigator.serviceWorker.register(
    `/firebase-messaging-sw.js?${buildWorkerQuery(config)}`,
  );
  const messaging = getMessaging(app);
  const fcmToken = await getToken(messaging, {
    vapidKey: config.vapidKey,
    serviceWorkerRegistration: registration,
  });
  if (!fcmToken) {
    return null;
  }
  await subscribePush(fcmToken, "web");
  if (!foregroundListenerAttached) {
    foregroundListenerAttached = true;
    onMessage(messaging, (payload: MessagePayload) => {
      const title = payload.notification?.title || "Northstone update";
      const body = payload.notification?.body || "You have a new CRM notification.";
      if (onToast) onToast(title, body);
    });
  }
  return fcmToken;
}
