// Service Worker for Web Push Notifications - Iverson Bar
const CACHE_NAME = 'iverson-bar-v1';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// 接收來自 server 的 push 事件
self.addEventListener('push', (event) => {
    if (!event.data) return;

    let data;
    try {
        data = event.data.json();
    } catch (e) {
        data = { title: '🍸 Iverson Bar', body: event.data.text() };
    }

    const options = {
        body: data.body || '',
        icon: data.icon || '/favicon.ico',
        badge: data.badge || '/favicon.ico',
        vibrate: data.vibrate || [200, 100, 200],
        tag: data.tag || 'bar-notification',
        renotify: true,
        data: data.data || {},
        actions: data.actions || []
    };

    event.waitUntil(
        self.registration.showNotification(data.title || '🍸 Iverson Bar', options)
    );
});

// 使用者點擊通知時，聚焦到 Bar 頁面
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // 如果已有開啟的視窗，就聚焦它
            for (const client of clientList) {
                if (client.url.includes('/') && 'focus' in client) {
                    return client.focus();
                }
            }
            // 否則開新視窗
            if (self.clients.openWindow) {
                return self.clients.openWindow('/');
            }
        })
    );
});

// 接收來自主頁面的 postMessage，直接在 SW 層顯示通知
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        const { title, options } = event.data;
        self.registration.showNotification(title, options || {});
    }
});
