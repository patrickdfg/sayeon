/* 새 사연 알림 — 휴대폰에 온 알림을 화면에 띄우고, 누르면 그 편을 연다.
 *
 * 알림만 맡는다. 화면이나 파일을 저장해 두는 일(fetch 가로채기)은 하지 않으므로
 * 새 사연을 올리면 지금처럼 바로 보인다.
 * 설정의 '새 사연 알림 → 받기'를 누른 기기에만 등록된다(settings.js).
 * 보내는 쪽은 tools/send_push.py.
 */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  var d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) {}
  event.waitUntil(self.registration.showNotification(d.title || '새 성령 사연', {
    body: d.body || '새 사연이 올라왔습니다',
    icon: '/sayeon/icons/icon-192.png?v=4',
    badge: '/sayeon/icons/icon-192.png?v=4',
    tag: d.tag || 'sayeon-new',
    data: { url: d.url || '/sayeon/' }
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || '/sayeon/';
  // 주소 뒤 #n= 만 바뀌면 이미 열린 화면은 다시 읽지 않으므로 ?p= 를 붙여 새로 연다
  var url = new URL(target, self.location.origin);
  url.searchParams.set('p', String(Date.now()));
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (new URL(c.url).pathname === '/sayeon/' && 'navigate' in c) {
          // 서비스 워커가 맡지 않은 창이면 navigate 가 거절되므로 그때는 새로 연다
          return c.navigate(url.href)
            .then(function (w) { return (w || c).focus(); })
            .catch(function () { return self.clients.openWindow(url.href); });
        }
      }
      return self.clients.openWindow(url.href);
    }));
});
