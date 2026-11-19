// Tells Bing, Yandex and other IndexNow search engines that the pages changed, so they visit soon.
// Run after a release:  node scripts/indexnow.mjs
// The key is public by design: it only proves the site owns the key file at the root.
const KEY = 'aa164e1fd0c5c7f739391623c4d5f2e2';
const HOST = 'birds-in-hk.org';
const urls = ['https://birds-in-hk.org/', 'https://birds-in-hk.org/about.html', 'https://birds-in-hk.org/?lang=en'];
const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: urls }),
});
console.log(`IndexNow: HTTP ${response.status} ${response.status === 200 || response.status === 202 ? '(received)' : await response.text()}`);
