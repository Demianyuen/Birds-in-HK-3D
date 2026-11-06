// Many birds in one sky: N bots join Wang Fuk Court, fly in circles at 4 poses a second,
// and count what they receive. Usage: node scripts/load-test.mjs [birds] [seconds] [base-url]
const BIRDS = Number(process.argv[2] ?? 60);
const SECONDS = Number(process.argv[3] ?? 20);
const BASE = process.argv[4] ?? 'ws://127.0.0.1:8787';
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:5173';
const MAX_ROOMS = 6;

function open(room) {
  return new WebSocket(`${BASE}/sky/court/${room}`, { headers: { Origin: ORIGIN } });
}

const bots = [];
function startBot(index) {
  const bot = { index, id: `bot-${String(index).padStart(4, '0')}-load`, room: 1, received: 0, joins: 0, sent: 0, ready: false, socket: null };
  const connect = () => {
    const socket = open(bot.room);
    bot.socket = socket;
    socket.addEventListener('open', () => socket.send(JSON.stringify({ t: 'hello', id: bot.id, name: `測試${index}`, plumage: 'white' })));
    socket.addEventListener('message', event => {
      const data = JSON.parse(event.data);
      if (data.t === 'full') { bot.room += 1; if (bot.room <= MAX_ROOMS) setTimeout(connect, 50); return; }
      if (data.t === 'welcome') bot.ready = true;
      if (data.t === 'pose') bot.received += 1;
      if (data.t === 'join') bot.joins += 1;
    });
    socket.addEventListener('error', () => {});
  };
  connect();
  bots.push(bot);
}

for (let index = 0; index < BIRDS; index += 1) setTimeout(() => startBot(index), index * 20);
await new Promise(resolve => setTimeout(resolve, BIRDS * 20 + 1500));

const started = Date.now();
const timer = setInterval(() => {
  const t = (Date.now() - started) / 1000;
  for (const bot of bots) {
    if (bot.socket?.readyState !== 1) continue;
    const angle = t * 0.3 + bot.index;
    bot.socket.send(JSON.stringify({ t: 'pose', p: [18 + Math.cos(angle) * 120, 200, 22 + Math.sin(angle) * 120], q: [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)], g: false }));
    bot.sent += 1;
  }
}, 250);
await new Promise(resolve => setTimeout(resolve, SECONDS * 1000));
clearInterval(timer);
await new Promise(resolve => setTimeout(resolve, 800));

const rooms = new Map();
for (const bot of bots) rooms.set(bot.room, (rooms.get(bot.room) ?? 0) + 1);
let expected = 0, received = 0;
for (const bot of bots) {
  const mates = rooms.get(bot.room) - 1;
  expected += mates * (bot.sent);
  received += bot.received;
}
const connected = bots.filter(bot => bot.socket?.readyState === 1).length;
console.log(JSON.stringify({ birds: BIRDS, connected, seconds: SECONDS, rooms: Object.fromEntries([...rooms].sort()), posesSent: bots.reduce((s, b) => s + b.sent, 0), posesDelivered: received, deliveryRatio: +(received / Math.max(1, expected)).toFixed(3) }, null, 1));
for (const bot of bots) bot.socket?.close();
setTimeout(() => process.exit(0), 300);
