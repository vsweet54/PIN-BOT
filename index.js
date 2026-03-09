require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { Ollama } = require('ollama');
const express = require('express');
const app = express();
const previews = new Map(); // id → { html, createdAt }

// Bersihkan preview lama setiap 1 jam
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of previews) {
    if (now - data.createdAt > 60 * 60 * 1000) previews.delete(id);
  }
}, 60 * 60 * 1000);

const PREVIEW_DOMAIN = process.env.RENDER_URL || 'http://localhost:8080';const PORT = process.env.PORT || 8080;

// Route home
app.get('/', (req, res) => {
  res.send('<h2>🤖 NEO AI Bot is running!</h2><p>Made by xyrons2</p>');
});

// Route preview HTML
app.get('/preview/:id', (req, res) => {
  const data = previews.get(req.params.id);
  if (!data) return res.status(404).send('<h2>Preview tidak ditemukan atau sudah expired (1 jam).</h2>');
  res.setHeader('Content-Type', 'text/html');
  res.send(data.html);
});

app.listen(PORT, () => console.log(`🌐 Preview server jalan di port ${PORT}`));

// ============================
//   KONFIGURASI BOT
// ============================
const MAX_HISTORY = 20;
const PREFIX = process.env.PREFIX || '!';
const BOT_NAME = 'NEO AI';
const CREATOR = 'xyrons2';
const OLLAMA_MODEL = 'gpt-oss:120b';
const CREATOR_ID = '701776430207598602'; // User ID xyrons2 — tidak bisa dipalsukan
const fs = require('fs');
const PREFIX_FILE = './prefixes.json';

// Load prefix dari file
function loadPrefixes() {
  try {
    if (fs.existsSync(PREFIX_FILE)) {
      const data = JSON.parse(fs.readFileSync(PREFIX_FILE, 'utf8'));
      const map = new Map();
      for (const [guildId, prefixes] of Object.entries(data)) {
        map.set(guildId, new Set(prefixes));
      }
      return map;
    }
  } catch (e) { console.error('❌ Gagal load prefix:', e.message); }
  return new Map();
}

// Simpan prefix ke file
function savePrefixes() {
  try {
    const data = {};
    for (const [guildId, prefixes] of guildPrefixes) {
      data[guildId] = [...prefixes];
    }
    fs.writeFileSync(PREFIX_FILE, JSON.stringify(data, null, 2));
  } catch (e) { console.error('❌ Gagal simpan prefix:', e.message); }
}

const guildPrefixes = loadPrefixes();

function getPrefixes(guildId) {
  if (!guildPrefixes.has(guildId)) guildPrefixes.set(guildId, new Set(['!']));
  return guildPrefixes.get(guildId);
}

function getPrefix(guildId) {
  return [...getPrefixes(guildId)][0];
}

function matchPrefix(content, guildId) {
  const prefixes = getPrefixes(guildId);
  for (const p of prefixes) {
    if (content.toLowerCase().startsWith(p.toLowerCase())) return p;
  }
  return null;
}

const ollama = new Ollama({
  host: 'https://ollama.com',
  headers: { Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY },
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

const conversations  = new Map();
const tebakGames    = new Map(); // userId → { angka, attempts }
const kuisGames     = new Map(); // userId → { soal, jawaban }
const userLocations = new Map(); // userId → kota
const marriages     = new Map(); // userId → partnerId
const nicknames     = new Map(); // userId → nickname (persistent, tidak hilang saat !reset)

// ============================
//   NICKNAME FUNCTIONS
// ============================
const NICKNAME_FILE = './nicknames.json';

function loadNicknames() {
  try {
    if (fs.existsSync(NICKNAME_FILE)) {
      const data = JSON.parse(fs.readFileSync(NICKNAME_FILE, 'utf8'));
      for (const [id, nick] of Object.entries(data)) nicknames.set(id, nick);
    }
  } catch (e) { console.error('❌ Gagal load nicknames:', e.message); }
}

function saveNicknames() {
  try {
    const data = {};
    for (const [id, nick] of nicknames) data[id] = nick;
    fs.writeFileSync(NICKNAME_FILE, JSON.stringify(data, null, 2));
  } catch (e) { console.error('❌ Gagal simpan nicknames:', e.message); }
}

// Detect nama dari kalimat user secara otomatis
function detectNickname(text) {
  const patterns = [
    /panggil\s+(?:aku|saya|gue|gw)\s+([A-Za-z0-9_]+)/i,
    /nama\s+(?:aku|saya|gue|gw)\s+(?:adalah\s+|itu\s+)?([A-Za-z0-9_]+)/i,
    /(?:aku|saya|gue|gw)\s+(?:namanya?|dipanggil)\s+([A-Za-z0-9_]+)/i,
    /sebut\s+(?:aku|saya|gue|gw)\s+([A-Za-z0-9_]+)/i,
    /call\s+me\s+([A-Za-z0-9_]+)/i,
    /my\s+name\s+is\s+([A-Za-z0-9_]+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return null;
}

loadNicknames();

// ============================
//   QUOTES OFFLINE FALLBACK
// ============================
const quotesOffline = [
  { text: 'Kesuksesan adalah hasil dari persiapan, kerja keras, dan belajar dari kegagalan.', author: 'Colin Powell' },
  { text: 'Jangan takut gagal. Takutlah untuk tidak mencoba.', author: 'Michael Jordan' },
  { text: 'Hidup adalah 10% apa yang terjadi padamu dan 90% bagaimana kamu meresponsnya.', author: 'Charles Swindoll' },
  { text: 'Satu-satunya cara untuk melakukan pekerjaan hebat adalah dengan mencintai apa yang kamu lakukan.', author: 'Steve Jobs' },
  { text: 'Bermimpilah besar, mulailah dari hal kecil, tapi yang terpenting mulailah sekarang.', author: 'Roy T. Bennett' },
  { text: 'Orang yang berhenti belajar akan menjadi tua, sedangkan orang yang terus belajar akan tetap muda.', author: 'Henry Ford' },
  { text: 'Keberhasilan bukan milik orang pintar, tapi milik orang yang pantang menyerah.', author: 'Bj Habibie' },
  { text: 'Jangan bandingkan perjalananmu dengan orang lain. Setiap orang punya timeline-nya sendiri.', author: 'Unknown' },
  { text: 'Kegagalan adalah guru terbaik yang pernah ada.', author: 'Oprah Winfrey' },
  { text: 'Mulailah dari mana kamu berada. Gunakan apa yang kamu punya. Lakukan apa yang kamu bisa.', author: 'Arthur Ashe' },
];

// ============================
//   HELPER: TYPING INDICATOR
// ============================
function keepTyping(channel) {
  channel.sendTyping();
  const interval = setInterval(() => channel.sendTyping(), 8000);
  return () => clearInterval(interval);
}

// ============================
//   HELPER: SPLIT MESSAGE
// ============================
function splitMessage(text, limit = 1990) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + limit));
    start += limit;
  }
  return chunks;
}

// ============================
//   SHIP IMAGE FUNCTION (PREMIUM DESIGN)
// ============================
async function generateShipImage(av1Url, av2Url, pct, name1 = 'User 1', name2 = 'User 2') {
  try {
    const Jimp = require('jimp');

    const W = 700, H = 220;
    const CORNER = 32;
    const AV_R = 72;
    const CY = Math.floor(H / 2);
    const AV_CX1 = 110;
    const AV_CX2 = W - 110;

    // Asset lokal
    const path = require('path');
    const HEART_PATH = path.join(__dirname, 'heart.png');
    const FLOWER_PATH = path.join(__dirname, 'flower.png');

    // Fetch avatar circular
    const fetchAvatar = async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const buf = Buffer.from(await res.arrayBuffer());
      const av  = await Jimp.read(buf);
      const D   = AV_R * 2;
      av.resize(D, D);
      const mask = new Jimp(D, D, 0x00000000);
      for (let x = 0; x < D; x++)
        for (let y = 0; y < D; y++)
          if (Math.hypot(x - AV_R, y - AV_R) <= AV_R - 1)
            mask.setPixelColor(0xffffffff, x, y);
      av.mask(mask, 0, 0);
      return av;
    };

    // Ambil warna dominan dari avatar
    const getDominantColor = (av) => {
      const D = AV_R * 2;
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let x = 8; x < D - 8; x += 2) {
        for (let y = 8; y < D - 8; y += 2) {
          if (Math.hypot(x - AV_R, y - AV_R) > AV_R - 8) continue;
          const hex = av.getPixelColor(x, y);
          const r = (hex >>> 24) & 0xff;
          const g = (hex >>> 16) & 0xff;
          const b = (hex >>> 8)  & 0xff;
          const a =  hex         & 0xff;
          if (a < 128) continue;
          if (r < 20 && g < 20 && b < 20) continue;
          if (r > 235 && g > 235 && b > 235) continue;
          rSum += r; gSum += g; bSum += b; count++;
        }
      }
      if (count === 0) return { r: 140, g: 80, b: 220 };
      return { r: Math.round(rSum/count), g: Math.round(gSum/count), b: Math.round(bSum/count) };
    };

    // Pastelkan warna biar lembut
    const pastel = (r, g, b, s = 0.50) => ({
      r: Math.round(r + (255-r)*s),
      g: Math.round(g + (255-g)*s),
      b: Math.round(b + (255-b)*s),
    });

    // Load semua sekaligus
    const [a1, a2, heartRaw, flowerRaw] = await Promise.all([
      fetchAvatar(av1Url),
      fetchAvatar(av2Url),
      Jimp.read(HEART_PATH),
      Jimp.read(FLOWER_PATH).catch(() => null),
    ]);

    const raw1 = getDominantColor(a1);
    const raw2 = getDominantColor(a2);
    const c1 = pastel(raw1.r, raw1.g, raw1.b);
    const c2 = pastel(raw2.r, raw2.g, raw2.b);

    // 1. Background gradient c1 → putih → c2
    const img = new Jimp(W, H, 0xffffffff);
    for (let x = 0; x < W; x++) {
      const t = x / (W - 1);
      let r, g, b;
      if (t < 0.5) {
        const tt = t * 2;
        r = Math.round(c1.r + (255 - c1.r) * tt * 0.6);
        g = Math.round(c1.g + (255 - c1.g) * tt * 0.6);
        b = Math.round(c1.b + (255 - c1.b) * tt * 0.6);
      } else {
        const tt = (t - 0.5) * 2;
        r = Math.round(255 - (255 - c2.r) * tt * 0.6);
        g = Math.round(255 - (255 - c2.g) * tt * 0.6);
        b = Math.round(255 - (255 - c2.b) * tt * 0.6);
      }
      for (let y = 0; y < H; y++)
        img.setPixelColor(Jimp.rgbaToInt(Math.min(255,r), Math.min(255,g), Math.min(255,b), 255), x, y);
    }

    // 2. Rounded corners mask
    img.scan(0, 0, W, H, function (x, y) {
      const inTL = x < CORNER     && y < CORNER     && Math.hypot(x-CORNER,     y-CORNER)     > CORNER;
      const inTR = x > W-1-CORNER && y < CORNER     && Math.hypot(x-(W-1-CORNER), y-CORNER)   > CORNER;
      const inBL = x < CORNER     && y > H-1-CORNER && Math.hypot(x-CORNER,     y-(H-1-CORNER)) > CORNER;
      const inBR = x > W-1-CORNER && y > H-1-CORNER && Math.hypot(x-(W-1-CORNER), y-(H-1-CORNER)) > CORNER;
      if (inTL || inTR || inBL || inBR) this.setPixelColor(0x00000000, x, y);
    });

    // 3. Border putih rounded
    const drawRingFill = (cx, cy, outerR, innerR, color) => {
      for (let x = cx - outerR - 1; x <= cx + outerR + 1; x++) {
        for (let y = cy - outerR - 1; y <= cy + outerR + 1; y++) {
          if (x < 0 || x >= W || y < 0 || y >= H) continue;
          const d = Math.hypot(x - cx, y - cy);
          if (d <= outerR && d >= innerR) img.setPixelColor(color, x, y);
        }
      }
    };

    for (let t = 0; t < 4; t++) {
      const alpha = Math.max(80, 210 - t * 45);
      const col = Jimp.rgbaToInt(255, 255, 255, alpha);
      const cr = CORNER - t;
      for (let x = CORNER; x < W - CORNER; x++) {
        img.setPixelColor(col, x, t);
        img.setPixelColor(col, x, H - 1 - t);
      }
      for (let y = CORNER; y < H - CORNER; y++) {
        img.setPixelColor(col, t, y);
        img.setPixelColor(col, W - 1 - t, y);
      }
      for (let a = 0; a <= 360; a += 0.8) {
        const rad = a * Math.PI / 180;
        const corners = [
          [CORNER,     CORNER,     Math.PI,     Math.PI * 1.5],
          [W - CORNER, CORNER,     Math.PI * 1.5, Math.PI * 2],
          [CORNER,     H - CORNER, Math.PI * 0.5, Math.PI],
          [W - CORNER, H - CORNER, 0,             Math.PI * 0.5],
        ];
        for (const [ccx, ccy] of corners) {
          const px = Math.round(ccx + cr * Math.cos(rad));
          const py = Math.round(ccy + cr * Math.sin(rad));
          if (px >= 0 && px < W && py >= 0 && py < H) img.setPixelColor(col, px, py);
        }
      }
    }

    // 4. Sparkle kecil
    const sparklePts = [[165,38,7],[530,50,6],[75,165,5],[612,160,6],[268,22,4],[432,25,4]];
    for (const [sx, sy, sz] of sparklePts) {
      const col = Jimp.rgbaToInt(255, 255, 255, 190);
      for (let i = -sz; i <= sz; i++) {
        if (sx+i >= 0 && sx+i < W) img.setPixelColor(col, sx+i, sy);
        if (sy+i >= 0 && sy+i < H) img.setPixelColor(col, sx, sy+i);
      }
    }

    // 5. Ring putih + avatar
    // Flower di belakang avatar
    if (flowerRaw) {
      const fRatio = (H * 1.3) / flowerRaw.getHeight();
      const fW = Math.round(flowerRaw.getWidth() * fRatio);
      const fH = Math.round(flowerRaw.getHeight() * fRatio);
      const yOff = -Math.round((fH - H) / 2);
      const flLeft = flowerRaw.clone().resize(fW, fH);
      img.composite(flLeft, -10, yOff);
      const flRight = flowerRaw.clone().resize(fW, fH).flip(true, false);
      img.composite(flRight, W - fW + 10, yOff);
    }

    const WHITE = Jimp.rgbaToInt(255, 255, 255, 255);
    drawRingFill(AV_CX1, CY, AV_R + 6, AV_R - 1, WHITE);
    drawRingFill(AV_CX2, CY, AV_R + 6, AV_R - 1, WHITE);
    img.composite(a1, AV_CX1 - AV_R, CY - AV_R);
    img.composite(a2, AV_CX2 - AV_R, CY - AV_R);

    // 6. Heart PNG di tengah
    const HEART_SIZE = 155;
    heartRaw.resize(HEART_SIZE, HEART_SIZE);
    const HCX = Math.floor(W / 2);
    img.composite(heartRaw, HCX - Math.floor(HEART_SIZE / 2), CY - Math.floor(HEART_SIZE / 2));

    // 7. Teks %
    const font = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
    const pctText = `${pct}%`;
    const tw = Jimp.measureText(font, pctText);
    const th = Jimp.measureTextHeight(font, pctText, tw + 10);
    img.print(font, HCX - Math.round(tw/2) + 2, CY - Math.round(th/2) + 2, pctText);
    img.print(font, HCX - Math.round(tw/2), CY - Math.round(th/2), pctText);

    return await img.getBufferAsync(Jimp.MIME_PNG);
  } catch (e) {
    console.error('❌ Ship image error:', e.message);
    return null;
  }
}
// ============================
//   AI FUNCTIONS
// ===========================
function generatePreviewId() {
  return Math.random().toString(36).slice(2, 10);
}

function extractHTML(text) {
  const codeBlockMatch = text.match(/```(?:html)?\n([\s\S]*?)```/i);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  if (/<html/i.test(text) || /<!DOCTYPE/i.test(text)) return text.trim();
  return null;
}

function formatResponse(text) {
  const codePatterns = [
    /<!DOCTYPE/i,
    /<html/i,
    /<\w+>.*<\/\w+>/s,
    /```[\s\S]*```/,
    /function\s+\w+\s*\(/,
    /const\s+\w+\s*=/,
    /let\s+\w+\s*=/,
    /var\s+\w+\s*=/,
    /import\s+.+\s+from/,
    /def\s+\w+\s*\(/,
    /class\s+\w+\s*[:{]/,
    /SELECT\s+.+\s+FROM/i,
    /#include\s*</,
    /\{\s*[\r\n][\s\S]*:\s*.+,?\s*[\r\n]\s*\}/,
  ];

  if (text.includes('```')) return text;

  const hasCode = codePatterns.some(p => p.test(text));
  if (!hasCode) return text;

  let lang = '';
  if (/<!DOCTYPE|<html/i.test(text)) lang = 'html';
  else if (/import\s+discord|client\s*=\s*discord/i.test(text)) lang = 'python';
  else if (/const\s+|let\s+|function\s+|=>\s*{/.test(text)) lang = 'js';
  else if (/def\s+\w+|import\s+\w+/.test(text)) lang = 'python';
  else if (/SELECT\s+/i.test(text)) lang = 'sql';
  else if (/#include/.test(text)) lang = 'cpp';

  return '```' + lang + '\n' + text.trim() + '\n```';
}

async function askAI(history, { nickname, isCreator } = {}) {
  // Tentukan nama yang dipakai untuk sapaan
  const sapaanName = nickname || (isCreator ? 'Tuan' : null);
  const nickInfo = nickname
    ? `Nama panggilan user ini adalah "${nickname}". Selalu panggil dia "${nickname}", bukan username Discord-nya. `
    : '';
  const creatorInfo = isCreator
    ? `User ini adalah pengembangmu (CREATOR). Perlakukan dengan istimewa dan hangat seperti teman dekat, bukan bawahan yang kaku. ${nickname ? `Panggil dia "${nickname}".` : 'Panggil dia "Tuan".'}  `
    : '';

  const res = await ollama.chat({
    model: OLLAMA_MODEL,
    messages: [
      {
        role: 'system',
        content:
          `Kamu adalah ${BOT_NAME}, teman ngobrol AI yang asik di Discord. Dibuat oleh ${CREATOR}. ` +
          `Jika ditanya siapa yang membuat kamu, jawab dibuat oleh ${CREATOR}. ` +
          `Jika ditanya kontak developer, jawab: "Hubungi langsung di Discord @xyrons2!" ` +
          creatorInfo +
          nickInfo +

          // === NAMA ===
          `Selalu awali jawaban dengan nama user. ${sapaanName ? `Nama yang dipakai: "${sapaanName}".` : 'Ambil nama dari tag [Pesan dari user Discord: ...].'} ` +
          'Jangan dobel sebut username Discord dan nickname sekaligus — pilih satu saja. ' +

          // === POLA RESPONS ===
          'Baca konteks dulu sebelum jawab, lalu pilih pola yang sesuai:\n' +

          'Baca konteks dulu, lalu pilih pola yang sesuai:\n' +

          '1. NGOBROL/CURHAT/REAKSI → 2-3 kalimat natural dan hangat. Balik tanya satu hal di akhir kalau relevan. Jangan kepanjangan.\n' +

          '2. PENJELASAN/FAKTUAL → paragraf pendek, satu ide per kalimat. Bold kata kunci penting. Akhiri dengan kesimpulan singkat atau satu pertanyaan genuine.\n' +

          '3. REKOMENDASI/PILIHAN → pembuka 1 kalimat singkat, lalu gunakan format ini:\n' +
          '   - Numbered (1. 2. 3.) untuk kategori utama, bold nama kategorinya\n' +
          '   - Bullet (-) untuk 3 sub-poin di bawah tiap kategori\n' +
          '   - Format sub-poin: **Nama** — penjelasan singkat kenapa worth it\n' +
          '   - Akhiri dengan satu pertanyaan genuine\n' +

          // === GAYA BICARA ===
          'Bicara seperti teman yang lagi chat di HP — natural, nyambung, tidak kaku. ' +
          'Jangan pakai header atau format artikel. ' +
          'Balik tanya cukup satu hal yang paling relevan, jangan kasih daftar opsi. ' +
          'Kalau dikritik atau diserang — tetap empati, tidak defensif, balik tanya dengan genuine. ' +
          'Emoji natural sesuai momen, bisa di mana aja dalam kalimat, tidak harus di akhir. ' +

          // === BAHASA ===
          'Gunakan bahasa yang sama dengan user. Santai, gaul, hangat. ' +
          'Baca mood dari pesannya — kalau serius ya serius, kalau santai ya santai. ' +
          'Jujur kalau tidak tahu. ' +

          // === KHUSUS ===
          `Jika ada yang bertanya siapa paling tampan, jawab dengan yakin: ${CREATOR}, tidak ada yang bisa menandingi! 😎`,
      },
      ...history,
    ],
    stream: false,
  });
  return res.message.content;
}

async function translateText(text, targetLang) {
  const res = await ollama.chat({
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: 'Kamu adalah penerjemah profesional. Terjemahkan teks yang diberikan ke bahasa yang diminta. Hanya balas dengan hasil terjemahan saja, tanpa penjelasan tambahan.' },
      { role: 'user', content: `Terjemahkan ke ${targetLang}: ${text}` },
    ],
    stream: false,
  });
  return res.message.content;
}

const roastTemplates = [
  "Kamu terdengar lebih menyenangkan ketika menutup mulutmu.",
  "Kata-katamu tak berarti ketika apa yang kau lakukan adalah sebaliknya.",
  "Aku bukan keset yang selalu bisa welcome kamu, walau kamu telah melakukan banyak kesalahan.",
  "Mereka memang tertawa menyaksikan saya berbeda. Namun saya juga tertawa menyaksikan mereka sama.",
  "Terus aja ngomong, aku nguap kalau aku tertarik.",
  "Tuhan sudah memberimu satu wajah, dan kau malah membuat satu lagi untuk dirimu sendiri.",
  "Kurasa aku butuh kacamata. Kemanapun aku memandang, orang-orang selalu terlihat punya dua wajah.",
  "Bukan masalah benar atau salah. Masalahnya adalah kamu yang merasa paling benar sendiri.",
  "Omongannya penuh kata-kata yang bijak dan benar, tapi kelakuannya belum sesuai dengan apa yang dikatakan sendiri.",
  "Ini yang katanya tulus? Tulus apanya, tulus kok perhitungan.",
  "Maaf ya, aku tidak ada waktu hanya untuk mendengarkan ucapanmu.",
  "Koreksilah diri sendiri daripada sibuk mengurusi orang lain!",
  "Orang yang memiliki sifat sok tahu hanya akan memperdalam ketidaktahuan yang dimilikinya.",
  "Apa gunanya kelihatan cantik di luar ketika kamu begitu jelek di dalam?",
  "Bercerminlah dahulu sebelum kamu membuat cermin orang lain.",
  "Otakmu tidak sebesar mulutmu.",
  "Orang yang otaknya kosong paling banyak bicaranya.",
  "Omonganmu seperti parfum isi ulang, wangi, tapi palsu.",
  "Bodoh kok dipiara, kambing dipiara bisa gemuk.",
  "Kamu terdengar lebih merdu ketika mulutmu tertutup.",
  "Nggak usah ngomentarin hidup gue, kayak lo gak ada kerjaan lain aja.",
  "Beberapa teman seperti uang receh, bermuka dua dan nilainya juga tidak seberapa.",
  "Aku benci orang bermuka dua. Sulit memutuskan muka mana yang harus kutampar terlebih dahulu.",
  "Kau mengingatkanku pada uang recehan. Bermuka dua dan tidak berharga.",
  "Karma tak pernah berjalan sendiri, ia selalu berjalan di belakangmu, menunggu waktu yang tepat.",
  "Ini hidupku, kenapa kamu yang jadi sutradara?",
  "Aku suka mendengarkan gosip, aku kagum bagaimana orang-orang bisa tahu hal-hal yang tak ku ketahui tentang diriku sendiri.",
  "Merendahkan orang lain berarti menunjukkan kelemahan diri sendiri.",
  "Orang akan menusukmu dari belakang kemudian bertanya kenapa kamu berdarah.",
  "Apa gunanya berusaha terlihat cantik jika aslinya hatimu busuk.",
  "Omonganmu seperti balon warna-warni, indah tapi isinya angin.",
  "Kamu tuh lucu banget, udah tau salah kok malah ngotot.",
  "Tak seorang pun mempercayai pembohong. Sekalipun dia menceritakan kebenaran.",
  "Lebih baik direndahkan karena kejujuran daripada dibanggakan dengan kebohongan.",
  "Bekerjalah seperti tuyul, nggak harus kelihatan, nggak butuh pujian, nggak gila jabatan, tapi hasilnya jelas.",
  "Pasti kamu capek karena harus pakai make up di dua wajah sekaligus.",
  "Dengan berbicara di belakangku, berarti kau cukup menghargai keberadaanku untuk tidak bertingkah di depan mukaku.",
  "Seseorang mestinya melihat dirinya terlebih dahulu baik-baik sebelum berpikir untuk mencerca keburukan orang lain.",
  "Mengalah bukan berarti kalah, tapi cara mengalahkan ego yang terlampau parah.",
  "Sekali-kali bolehlah menjadi orang yang jahat karena menjadi orang baik terus malah dimanfaatin sama teman sendiri.",
];

function roastUser(targetName) {
  const shuffled = [...roastTemplates].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, 3);
  return picked.join('\n\n').replace(/\{name\}/g, targetName);
}

async function ringkasText(text) {
  const res = await ollama.chat({
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: 'Kamu adalah asisten meringkas teks. Ringkas teks yang diberikan menjadi poin-poin penting yang singkat dan jelas. Gunakan bullet point (•). Maksimal 5 poin. Jawab dalam bahasa yang sama dengan teks input.' },
      { role: 'user', content: `Ringkas teks berikut:\n\n${text}` },
    ],
    stream: false,
  });
  return res.message.content;
}

async function generateKuis() {
  const res = await ollama.chat({
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: 'Kamu adalah pembuat soal trivia. Buat 1 soal trivia pengetahuan umum dalam Bahasa Indonesia. Format jawaban HARUS persis seperti ini (tanpa teks lain apapun):\nSOAL: <pertanyaan>\nJAWABAN: <jawaban singkat>' },
      { role: 'user', content: 'Buat soal trivia sekarang.' },
    ],
    stream: false,
  });
  const text = res.message.content;
  const soalMatch    = text.match(/SOAL:\s*(.+)/i);
  const jawabanMatch = text.match(/JAWABAN:\s*(.+)/i);
  if (!soalMatch || !jawabanMatch) throw new Error('Format soal tidak valid');
  return { soal: soalMatch[1].trim(), jawaban: jawabanMatch[1].trim().toLowerCase() };
}

async function generateTruth() {
  const res = await ollama.chat({
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: 'Kamu adalah pembuat pertanyaan truth (jujur-jujuran) yang seru untuk dimainkan bersama teman di Discord. Buat 1 pertanyaan truth yang lucu, menggelitik, dan tidak terlalu sensitif. Gunakan bahasa gaul Indonesia. Hanya balas pertanyaannya saja, tanpa penjelasan tambahan.' },
      { role: 'user', content: 'Kasih satu pertanyaan truth dong!' },
    ],
    stream: false,
  });
  return res.message.content.trim();
}

async function generateDare() {
  const res = await ollama.chat({
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: 'Kamu adalah pembuat dare challenge yang lucu dan seru untuk dimainkan bersama teman di Discord. Buat 1 dare/tantangan yang menghibur, tidak berbahaya, dan bisa dilakukan di Discord atau kehidupan sehari-hari. Contoh: bikin suara aneh, bilang sesuatu dengan aksen, edit profile sebentar, dll. Gunakan bahasa gaul Indonesia yang santai. Hanya balas challenge-nya saja, tanpa penjelasan tambahan.' },
      { role: 'user', content: 'Kasih satu dare challenge dong!' },
    ],
    stream: false,
  });
  return res.message.content.trim();
}


// ============================
//   TAROT FUNCTIONS
// ============================
const tarotCards = [
  { name: 'The Fool', emoji: '🃏', meaning: 'Awal baru, petualangan, spontanitas' },
  { name: 'The Magician', emoji: '🔮', meaning: 'Kekuatan, kemampuan, manifestasi' },
  { name: 'The High Priestess', emoji: '🌙', meaning: 'Intuisi, misteri, kebijaksanaan batin' },
  { name: 'The Empress', emoji: '🌸', meaning: 'Kesuburan, kelimpahan, kreativitas' },
  { name: 'The Emperor', emoji: '👑', meaning: 'Otoritas, stabilitas, kepemimpinan' },
  { name: 'The Hierophant', emoji: '⛪', meaning: 'Tradisi, kepercayaan, bimbingan spiritual' },
  { name: 'The Lovers', emoji: '💑', meaning: 'Cinta, harmoni, pilihan penting' },
  { name: 'The Chariot', emoji: '🏆', meaning: 'Kemenangan, tekad, kontrol' },
  { name: 'Strength', emoji: '🦁', meaning: 'Keberanian, kesabaran, kekuatan batin' },
  { name: 'The Hermit', emoji: '🕯️', meaning: 'Introspeksi, kesendirian, pencarian jiwa' },
  { name: 'Wheel of Fortune', emoji: '☸️', meaning: 'Nasib, siklus, titik balik' },
  { name: 'Justice', emoji: '⚖️', meaning: 'Keadilan, kebenaran, keseimbangan' },
  { name: 'The Hanged Man', emoji: '🙃', meaning: 'Pengorbanan, perspektif baru, penangguhan' },
  { name: 'Death', emoji: '💀', meaning: 'Transformasi, akhir, perubahan besar' },
  { name: 'Temperance', emoji: '🌊', meaning: 'Keseimbangan, moderasi, kesabaran' },
  { name: 'The Devil', emoji: '😈', meaning: 'Ketergantungan, materialisme, bayangan diri' },
  { name: 'The Tower', emoji: '⚡', meaning: 'Kehancuran tiba-tiba, kekacauan, wahyu' },
  { name: 'The Star', emoji: '⭐', meaning: 'Harapan, inspirasi, kedamaian' },
  { name: 'The Moon', emoji: '🌕', meaning: 'Ilusi, ketakutan, alam bawah sadar' },
  { name: 'The Sun', emoji: '☀️', meaning: 'Kebahagiaan, kesuksesan, vitalitas' },
  { name: 'Judgement', emoji: '📯', meaning: 'Refleksi, kebangkitan, panggilan jiwa' },
  { name: 'The World', emoji: '🌍', meaning: 'Penyelesaian, integrasi, pencapaian' },
];

async function generateTarot(username) {
  // Tarik 3 kartu random (past, present, future)
  const shuffled = [...tarotCards].sort(() => Math.random() - 0.5);
  const [past, present, future] = shuffled.slice(0, 3);

  const res = await ollama.chat({
    model: OLLAMA_MODEL,
    messages: [
      {
        role: 'system',
        content: 'Kamu adalah pembaca tarot mistis yang bijak dan penuh intuisi. Berikan ramalan tarot dalam format berikut PERSIS:\n\nSatu kalimat pembuka yang mystical dan personal.\n\n• [poin penting 1]\n• [poin penting 2]\n• [poin penting 3]\n\nSatu kalimat penutup yang menginspirasi.\n\nGunakan bahasa Indonesia yang mystical namun mudah dipahami. Jangan sebut "berdasarkan kartu". Total maksimal 6 baris.',
      },
      {
        role: 'user',
        content: `Buat ramalan tarot untuk ${username}. Kartu yang ditarik:
- Masa Lalu: ${past.name} (${past.meaning})
- Masa Kini: ${present.name} (${present.meaning})
- Masa Depan: ${future.name} (${future.meaning})`,
      },
    ],
    stream: false,
  });

  return { past, present, future, reading: res.message.content.trim() };
}




async function generateShipKomen(name1, name2, pct) {
  const level = pct >= 80 ? 'SANGAT TINGGI — mereka jodoh banget, udah kayak takdir, romantis abis' :
                pct >= 60 ? 'TINGGI — cocok dan ada chemistry kuat, tinggal PDKT aja' :
                pct >= 40 ? 'SEDANG — lumayan ada potensi tapi masih perlu usaha' :
                pct >= 20 ? 'RENDAH — kurang cocok, chemistry-nya lemah banget' :
                            'SANGAT RENDAH — gak cocok sama sekali, beda dunia, hopeless';
  const res = await ollama.chat({
    model: OLLAMA_MODEL,
    messages: [
      {
        role: 'system',
        content: `Kamu adalah komentator ship/love meter di Discord. Buat komentar 2-3 kalimat dalam bahasa gaul Indonesia yang WAJIB mencerminkan tingkat kecocokan yang diberikan. Jangan kontradiksi persennya — kalau rendah harus terdengar pesimis/lucu, kalau tinggi harus terdengar optimis/romantis. Sertakan emoji relevan.`,
      },
      {
        role: 'user',
        content: `Buat komentar ship untuk ${name1} dan ${name2}. Persentase kecocokan: ${pct}% — level: ${level}. Komentar HARUS sesuai level ini.`,
      },
    ],
    stream: false,
  });
  return res.message.content.trim();
}


async function generateTarotImage(past, present, future, username) {
  try {
    const Jimp = require('jimp');

    const W = 680, H = 280;
    const CORNER = 24;

    // Background gelap mystical
    const img = new Jimp(W, H, 0x000000ff);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        const t = x / (W - 1);
        const vx = Math.abs(x - W/2) / (W/2);
        const vy = Math.abs(y - H/2) / (H/2);
        const v = (vx*vx + vy*vy) * 0.3;
        const r = Math.round((20 + (40-20)*t) * (1-v));
        const g = Math.round((10 + (15-10)*t) * (1-v));
        const b = Math.round((50 + (80-50)*t) * (1-v));
        img.setPixelColor(Jimp.rgbaToInt(
          Math.max(0,Math.min(255,r)),
          Math.max(0,Math.min(255,g)),
          Math.max(0,Math.min(255,b)), 255), x, y);
      }
    }

    // Rounded corner mask
    img.scan(0, 0, W, H, function(x, y) {
      const inTL = x < CORNER     && y < CORNER     && Math.hypot(x-CORNER,     y-CORNER)     > CORNER;
      const inTR = x > W-1-CORNER && y < CORNER     && Math.hypot(x-(W-1-CORNER), y-CORNER)   > CORNER;
      const inBL = x < CORNER     && y > H-1-CORNER && Math.hypot(x-CORNER,     y-(H-1-CORNER)) > CORNER;
      const inBR = x > W-1-CORNER && y > H-1-CORNER && Math.hypot(x-(W-1-CORNER), y-(H-1-CORNER)) > CORNER;
      if (inTL || inTR || inBL || inBR) this.setPixelColor(0x00000000, x, y);
    });

    // Border gold
    for (let t = 0; t < 3; t++) {
      const alpha = Math.max(100, 200 - t*50);
      const col = Jimp.rgbaToInt(200, 160, 40, alpha);
      for (let x = CORNER; x < W-CORNER; x++) {
        img.setPixelColor(col, x, t);
        img.setPixelColor(col, x, H-1-t);
      }
      for (let y = CORNER; y < H-CORNER; y++) {
        img.setPixelColor(col, t, y);
        img.setPixelColor(col, W-1-t, y);
      }
    }

    // Bintang random
    const starPositions = [
      [50,30],[120,20],[200,40],[350,15],[450,25],[550,35],[630,20],
      [80,240],[170,260],[300,250],[420,265],[560,245],[650,255],
      [30,120],[660,100],[25,180],[665,160],[310,50],[370,230],
      [140,80],[520,70],[200,200],[480,190],[100,150],[580,140],
    ];
    for (const [sx, sy] of starPositions) {
      const sa = Math.floor(Math.random() * 120 + 80);
      img.setPixelColor(Jimp.rgbaToInt(255, 255, 200, sa), sx, sy);
      img.setPixelColor(Jimp.rgbaToInt(255, 255, 200, Math.floor(sa*0.5)), sx+1, sy);
      img.setPixelColor(Jimp.rgbaToInt(255, 255, 200, Math.floor(sa*0.5)), sx, sy+1);
    }

    // Title text
    const fontWhite = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
    const title = '* RAMALAN TAROT *';
    const tw = Jimp.measureText(fontWhite, title);
    img.print(fontWhite, Math.round(W/2 - tw/2), 8, title);

    // 3 kartu
    const CW = 170, CH = 195;
    const GAP = Math.round((W - 3*CW) / 4);
    const Y_CARD = 45;

    const cardColors = [
      { r: 80,  g: 30, b: 120 },  // past - ungu
      { r: 140, g: 90, b: 10  },  // present - emas
      { r: 20,  g: 60, b: 150 },  // future - biru
    ];
    const cards = [
      { card: past,    label: 'MASA LALU',   color: cardColors[0] },
      { card: present, label: 'MASA KINI',   color: cardColors[1] },
      { card: future,  label: 'MASA DEPAN',  color: cardColors[2] },
    ];

    for (let i = 0; i < 3; i++) {
      const { card, label, color } = cards[i];
      const cx = GAP + i * (CW + GAP);
      const cy = Y_CARD;

      // Card background gradient
      for (let px = cx; px < cx+CW; px++) {
        for (let py = cy; py < cy+CH; py++) {
          if (px < 0 || px >= W || py < 0 || py >= H) continue;
          const t = (py - cy) / CH;
          const cr = Math.min(255, Math.round(color.r * 0.4 + color.r * 0.4 * t + 15));
          const cg = Math.min(255, Math.round(color.g * 0.4 + color.g * 0.4 * t + 8));
          const cb = Math.min(255, Math.round(color.b * 0.4 + color.b * 0.4 * t + 30));
          // Rounded corners kartu
          const inTL = px-cx < 14     && py-cy < 14     && Math.hypot(px-cx-14,     py-cy-14)     > 14;
          const inTR = px-cx > CW-15  && py-cy < 14     && Math.hypot(px-cx-(CW-14), py-cy-14)    > 14;
          const inBL = px-cx < 14     && py-cy > CH-15  && Math.hypot(px-cx-14,     py-cy-(CH-14))> 14;
          const inBR = px-cx > CW-15  && py-cy > CH-15  && Math.hypot(px-cx-(CW-14), py-cy-(CH-14))> 14;
          if (!inTL && !inTR && !inBL && !inBR)
            img.setPixelColor(Jimp.rgbaToInt(cr, cg, cb, 230), px, py);
        }
      }

      // Label bar di atas kartu
      for (let px = cx+1; px < cx+CW-1; px++) {
        for (let py = cy+1; py < cy+22; py++) {
          if (px < W && py < H)
            img.setPixelColor(Jimp.rgbaToInt(color.r, color.g, color.b, 200), px, py);
        }
      }

      // Border gold kartu
      const gold = Jimp.rgbaToInt(200, 160, 40, 180);
      for (let px = cx; px < cx+CW; px++) {
        if (px >= 0 && px < W) {
          img.setPixelColor(gold, px, cy);
          img.setPixelColor(gold, px, cy+CH-1);
        }
      }
      for (let py = cy; py < cy+CH; py++) {
        if (py >= 0 && py < H) {
          img.setPixelColor(gold, cx, py);
          img.setPixelColor(gold, cx+CW-1, py);
        }
      }

      // Label text
      const lw = Jimp.measureText(fontWhite, label);
      img.print(fontWhite, cx + Math.round((CW-lw)/2), cy+3, label);

      // Nama kartu — pakai font16 biar ga kepotong
      const cardName = card.name;
      const ew = Jimp.measureText(fontWhite, cardName);
      img.print(fontWhite, cx + Math.round((CW-ew)/2), cy + 65, cardName);

      // Meaning text (wrap manual)
      const words = card.meaning.split(', ');
      const line1 = words.slice(0, Math.ceil(words.length/2)).join(', ');
      const line2 = words.slice(Math.ceil(words.length/2)).join(', ');
      const mw1 = Jimp.measureText(fontWhite, line1);
      const mw2 = Jimp.measureText(fontWhite, line2);
      img.print(fontWhite, cx + Math.round((CW-mw1)/2), cy + 120, line1);
      if (line2) img.print(fontWhite, cx + Math.round((CW-mw2)/2), cy + 140, line2);

      // Arrow antar kartu
      if (i < 2) {
        const ax = cx + CW + Math.round(GAP/2) - 4;
        const ay = cy + Math.round(CH/2);
        const arrow = Jimp.rgbaToInt(200, 160, 40, 180);
        for (let t = -6; t <= 6; t++) {
          if (ax+t >= 0 && ax+t < W && ay >= 0 && ay < H)
            img.setPixelColor(arrow, ax+t, ay);
        }
      }
    }

    // Username di bawah
    const unText = '[ ' + username + ' ]';
    const unw = Jimp.measureText(fontWhite, unText);
    img.print(fontWhite, Math.round(W/2 - unw/2), H-20, unText);

    return await img.getBufferAsync(Jimp.MIME_PNG);
  } catch (e) {
    console.error('❌ Tarot image error:', e.message);
    return null;
  }
}


async function generateCerita(tema) {
  const res = await ollama.chat({
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: 'Kamu adalah penulis cerita pendek kreatif. Buat cerita pendek yang menarik dan memiliki awal-tengah-akhir yang jelas. Panjang cerita sekitar 150-200 kata. Gunakan Bahasa Indonesia yang enak dibaca. Langsung mulai ceritanya tanpa preamble.' },
      { role: 'user', content: `Buat cerita pendek dengan tema: ${tema}` },
    ],
    stream: false,
  });
  return res.message.content.trim();
}

async function generateCurhat(curhat) {
  const res = await ollama.chat({
    model: OLLAMA_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'Kamu adalah sahabat yang penuh empati, hangat, dan pengertian. ' +
          'Seseorang ingin curhat kepadamu. Berikan respons yang:\n' +
          '1. Validasi perasaan mereka terlebih dahulu\n' +
          '2. Tunjukkan empati yang tulus\n' +
          '3. Berikan perspektif positif atau saran ringan jika perlu\n' +
          '4. Akhiri dengan kalimat penyemangat yang tulus\n' +
          'Gunakan bahasa Indonesia yang hangat dan natural seperti teman dekat.',
      },
      { role: 'user', content: curhat },
    ],
    stream: false,
  });
  return res.message.content.trim();
}

async function fetchOnlineQuote() {
  const res = await fetch('https://zenquotes.io/api/random', {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error('Gagal fetch quote');
  const data = await res.json();
  return { text: data[0].q, author: data[0].a };
}

// ============================
//   SEARCH FUNCTIONS
// ============================

async function searchSerpApi(query) {
  const params = new URLSearchParams({
    q: query,
    api_key: process.env.SERPAPI_KEY,
    hl: 'id',
    gl: 'id',
    num: '5',
  });
  const res = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!res.ok) throw new Error(`SerpApi HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);

  const results = [];
  if (data.answer_box?.answer)   results.push({ snippet: data.answer_box.answer,  source: 'Google Answer' });
  else if (data.answer_box?.snippet) results.push({ snippet: data.answer_box.snippet, source: 'Google Answer' });
  for (const r of (data.organic_results || []).slice(0, 4)) {
    if (r.snippet) results.push({ snippet: r.snippet, source: r.displayed_link || r.link });
  }
  if (results.length === 0) throw new Error('Tidak ada hasil SerpApi');
  return { results, engine: '🟠 Google' };
}

async function searchDuckDuckGo(query) {
  const params = new URLSearchParams({ q: query, format: 'json', no_html: '1', skip_disambig: '1' });
  const res = await fetch(`https://api.duckduckgo.com/?${params}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const data = await res.json();

  const results = [];
  if (data.AbstractText) results.push({ snippet: data.AbstractText, source: data.AbstractURL || 'duckduckgo.com' });
  for (const t of (data.RelatedTopics || []).slice(0, 3)) {
    if (t.Text) results.push({ snippet: t.Text, source: t.FirstURL || 'duckduckgo.com' });
  }
  if (results.length === 0) throw new Error('Tidak ada hasil DuckDuckGo');
  return { results, engine: '🟡 DuckDuckGo' };
}

async function searchWeb(query) {
  if (process.env.SERPAPI_KEY) {
    try {
      return await searchSerpApi(query);
    } catch (err) {
      console.warn('⚠️ SerpApi gagal, fallback ke DuckDuckGo:', err.message);
    }
  }
  return await searchDuckDuckGo(query);
}

async function rangkumHasilCari(query, results) {
  const konteks = results.map((r, i) => `[${i + 1}] ${r.snippet} (${r.source})`).join('\n');
  const res = await ollama.chat({
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: 'Kamu adalah asisten pencarian yang membantu. Berdasarkan hasil pencarian yang diberikan, buat ringkasan yang informatif, jelas, dan mudah dipahami. Gunakan Bahasa Indonesia. Maksimal 4-5 kalimat. Langsung ke inti, jangan sebut "berdasarkan hasil pencarian".' },
      { role: 'user', content: `Pertanyaan: ${query}\n\nHasil pencarian:\n${konteks}` },
    ],
    stream: false,
  });
  return res.message.content.trim();
}

// ============================
//   JADWAL SHOLAT FUNCTIONS
// ============================

function isRamadan() {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const ramadanStart = new Date('2026-02-18');
  const ramadanEnd   = new Date('2026-03-19');
  return now >= ramadanStart && now <= ramadanEnd;
}

async function getJadwalSholat(kota) {
  const today = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const day   = today.getUTCDate();
  const month = today.getUTCMonth() + 1;
  const year  = today.getUTCFullYear();

  const res = await fetch(
    `https://api.aladhan.com/v1/timingsByCity/${day}-${month}-${year}?city=${encodeURIComponent(kota)}&country=Indonesia&method=11`
  );
  if (!res.ok) throw new Error('Kota tidak ditemukan');
  const data = await res.json();
  if (data.code !== 200) throw new Error('Kota tidak ditemukan');
  return data.data.timings;
}

function getNextWaktu(timings, ramadan) {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const nowStr = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;

  const urutan = ramadan
    ? ['Imsak', 'Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']
    : ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

  for (const waktu of urutan) {
    const t = timings[waktu]?.slice(0, 5);
    if (t && t > nowStr) {
      const [h, m] = t.split(':').map(Number);
      const [nh, nm] = nowStr.split(':').map(Number);
      const diffMenit = (h * 60 + m) - (nh * 60 + nm);
      const label = {
        Imsak: '🌅 Imsak', Fajr: '🌄 Subuh', Dhuhr: '☀️ Dzuhur',
        Asr: '🌤️ Ashar', Maghrib: '🌇 Magrib', Isha: '🌙 Isya',
      }[waktu];
      return `${label} dalam **${diffMenit} menit**`;
    }
  }
  return '🌅 Imsak esok hari';
}

function formatJadwal(kota, timings) {
  const now     = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const pad     = n => String(n).padStart(2, '0');
  const ramadan = isRamadan();

  const hari = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'][now.getUTCDay()];
  const tgl  = `${hari}, ${now.getUTCDate()} ${['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][now.getUTCMonth()]} ${now.getUTCFullYear()}`;
  const jamSekarang = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())} WIB`;
  const nextWaktu   = getNextWaktu(timings, ramadan);

  let msg = ramadan
    ? `🌙 **Jadwal Ramadan - ${kota}**\n`
    : `🕌 **Jadwal Sholat - ${kota}**\n`;

  msg += `📅 ${tgl}\n`;
  msg += `🕐 Sekarang: **${jamSekarang}**\n\n`;

  if (ramadan) {
    msg += `🌅 Imsak  : **${timings.Imsak?.slice(0,5)}**\n`;
    msg += `🍽️ Sahur  : **${timings.Fajr?.slice(0,5)}** *(batas)*\n`;
  }
  msg += `🌄 Subuh  : **${timings.Fajr?.slice(0,5)}**\n`;
  msg += `☀️ Dzuhur : **${timings.Dhuhr?.slice(0,5)}**\n`;
  msg += `🌤️ Ashar  : **${timings.Asr?.slice(0,5)}**\n`;
  msg += `🌇 Magrib : **${timings.Maghrib?.slice(0,5)}**${ramadan ? ' ← Buka puasa! 🤲' : ''}\n`;
  msg += `🌙 Isya   : **${timings.Isha?.slice(0,5)}**\n`;
  msg += `\n⏳ Berikutnya: ${nextWaktu}`;
  msg += `\n\n> 🗑️ *Pesan ini otomatis terhapus dalam 60 detik*`;

  return msg;
}


// ============================
//   SLASH COMMANDS DEFINITION
// ============================
const slashCommands = [
  new SlashCommandBuilder().setName('help').setDescription('Lihat semua perintah NEO AI'),
  new SlashCommandBuilder().setName('ai').setDescription('Tanya AI').addStringOption(o => o.setName('pertanyaan').setDescription('Pertanyaan kamu').setRequired(true)),
  new SlashCommandBuilder().setName('cari').setDescription('Cari di internet').addStringOption(o => o.setName('query').setDescription('Kata kunci pencarian').setRequired(true)),
  new SlashCommandBuilder().setName('image').setDescription('Generate gambar AI').addStringOption(o => o.setName('deskripsi').setDescription('Deskripsi gambar').setRequired(true)),
  new SlashCommandBuilder().setName('cuaca').setDescription('Info cuaca').addStringOption(o => o.setName('kota').setDescription('Nama kota').setRequired(true)),
  new SlashCommandBuilder().setName('terjemah').setDescription('Terjemahkan teks').addStringOption(o => o.setName('bahasa').setDescription('Bahasa tujuan').setRequired(true)).addStringOption(o => o.setName('teks').setDescription('Teks yang diterjemahkan').setRequired(true)),
  new SlashCommandBuilder().setName('quote').setDescription('Kutipan motivasi random'),
  new SlashCommandBuilder().setName('roast').setDescription('Roast seseorang').addUserOption(o => o.setName('user').setDescription('User yang mau diroast').setRequired(true)),
  new SlashCommandBuilder().setName('pp').setDescription('Lihat foto profil').addUserOption(o => o.setName('user').setDescription('User yang mau dilihat PP-nya')),
  new SlashCommandBuilder().setName('ship').setDescription('Cek kecocokan dua orang').addUserOption(o => o.setName('user1').setDescription('User pertama').setRequired(true)).addUserOption(o => o.setName('user2').setDescription('User kedua').setRequired(true)),
  new SlashCommandBuilder().setName('ping').setDescription('Cek latency bot'),
  new SlashCommandBuilder().setName('reset').setDescription('Reset history chat'),
  new SlashCommandBuilder().setName('ringkas').setDescription('Ringkas teks panjang').addStringOption(o => o.setName('teks').setDescription('Teks yang mau diringkas').setRequired(true)),
  new SlashCommandBuilder().setName('hitung').setDescription('Kalkulator').addStringOption(o => o.setName('ekspresi').setDescription('Ekspresi matematika').setRequired(true)),
  new SlashCommandBuilder().setName('curhat').setDescription('Curhat ke AI').addStringOption(o => o.setName('isi').setDescription('Isi curhatanmu').setRequired(true)),
  new SlashCommandBuilder().setName('horoscope').setDescription('Ramalan bintang harian').addStringOption(o => o.setName('zodiak').setDescription('Zodiak kamu').setRequired(true).addChoices(
    { name: 'Aries', value: 'aries' }, { name: 'Taurus', value: 'taurus' }, { name: 'Gemini', value: 'gemini' },
    { name: 'Cancer', value: 'cancer' }, { name: 'Leo', value: 'leo' }, { name: 'Virgo', value: 'virgo' },
    { name: 'Libra', value: 'libra' }, { name: 'Scorpio', value: 'scorpio' }, { name: 'Sagittarius', value: 'sagittarius' },
    { name: 'Capricorn', value: 'capricorn' }, { name: 'Aquarius', value: 'aquarius' }, { name: 'Pisces', value: 'pisces' }
  )),
  new SlashCommandBuilder().setName('truth').setDescription('Pertanyaan truth random'),
  new SlashCommandBuilder().setName('dare').setDescription('Challenge dare random'),
  new SlashCommandBuilder().setName('cerita').setDescription('Bikin cerita pendek').addStringOption(o => o.setName('tema').setDescription('Tema cerita').setRequired(true)),
  new SlashCommandBuilder().setName('kuis').setDescription('Main trivia'),
  new SlashCommandBuilder().setName('tarot').setDescription('Ramalan tarot 3 kartu (past, present, future)'),
  new SlashCommandBuilder().setName('jadwal').setDescription('Jadwal sholat').addStringOption(o => o.setName('kota').setDescription('Nama kota (opsional kalau sudah set lokasi)')),
].map(cmd => cmd.toJSON());

// ============================
//   WEATHER HELPER FUNCTIONS (GLOBAL SCOPE)
// ============================
const weatherCache = new Map(); // city → { data, expiry }

// Translation Bahasa Indonesia → English (100+ cities)
const cityTranslationMap = {
  // Jawa
  'jakarta': 'Jakarta', 'jkt': 'Jakarta',
  'bandung': 'Bandung',
  'surabaya': 'Surabaya', 'sby': 'Surabaya',
  'semarang': 'Semarang',
  'yogyakarta': 'Yogyakarta', 'yogya': 'Yogyakarta', 'jogja': 'Yogyakarta',
  'bogor': 'Bogor',
  'depok': 'Depok',
  'bekasi': 'Bekasi',
  'tangerang': 'Tangerang',
  'garut': 'Garut',
  'tasikmalaya': 'Tasikmalaya',
  'cirebon': 'Cirebon', 'cirbon': 'Cirebon',
  'sukabumi': 'Sukabumi',
  'ciamis': 'Ciamis',
  'salatiga': 'Salatiga',
  'purwokerto': 'Purwokerto',
  'pekalongan': 'Pekalongan',
  'kudus': 'Kudus',
  'jepara': 'Jepara',
  'pati': 'Pati',
  'demak': 'Demak',
  'wonosobo': 'Wonosobo',
  'pasuruan': 'Pasuruan',
  'malang': 'Malang',
  'probolinggo': 'Probolinggo',
  'jember': 'Jember',
  'blitar': 'Blitar',
  'tulungagung': 'Tulungagung',
  'nganjuk': 'Nganjuk',
  'kediri': 'Kediri',
  'mojokerto': 'Mojokerto',
  'gresik': 'Gresik',
  'lamongan': 'Lamongan',
  'tuban': 'Tuban',
  'bojonegoro': 'Bojonegoro',
  'medan': 'Medan',
  'palembang': 'Palembang',
  'pekanbaru': 'Pekanbaru',
  'jambi': 'Jambi',
  'bengkulu': 'Bengkulu',
  'bandar lampung': 'Bandar Lampung',
  'lampung': 'Bandar Lampung',
  'aceh': 'Aceh',
  'banda aceh': 'Banda Aceh',
  'lhokseumawe': 'Lhokseumawe',
  'asahan': 'Asahan',
  'batam': 'Batam',
  'tanjung pinang': 'Tanjung Pinang',
  'padang': 'Padang',
  'pariaman': 'Pariaman',
  'pontianak': 'Pontianak',
  'banjarmasin': 'Banjarmasin',
  'samarinda': 'Samarinda',
  'balikpapan': 'Balikpapan',
  'bontang': 'Bontang',
  'palangkaraya': 'Palangkaraya',
  'ketapang': 'Ketapang',
  'singkawang': 'Singkawang',
  'makassar': 'Makassar',
  'manado': 'Manado',
  'kendari': 'Kendari',
  'palu': 'Palu',
  'gorontalo': 'Gorontalo',
  'tomohon': 'Tomohon',
  'bitung': 'Bitung',
  'tondano': 'Tondano',
  'pare-pare': 'Pare-Pare',
  'parepare': 'Pare-Pare',
  'palopo': 'Palopo',
  'watermasi': 'Watermasi',
  'denpasar': 'Denpasar',
  'bali': 'Denpasar',
  'mataram': 'Mataram',
  'kupang': 'Kupang',
  'singaraja': 'Singaraja',
  'jayapura': 'Jayapura',
  'manokwari': 'Manokwari',
  'sorong': 'Sorong',
  'ambon': 'Ambon',
  'ternate': 'Ternate',
  'tidore': 'Tidore',
};

// Coordinates fallback untuk kota-kota
const cityCoordinates = {
  'pasuruan': { lat: -7.6471, lng: 112.9063 },
  'malang': { lat: -7.9827, lng: 112.6345 },
  'probolinggo': { lat: -7.7156, lng: 112.7920 },
  'jember': { lat: -8.1733, lng: 113.7000 },
  'blitar': { lat: -8.2258, lng: 112.2028 },
  'tulungagung': { lat: -8.0681, lng: 111.8928 },
  'nganjuk': { lat: -7.5956, lng: 111.9002 },
  'kediri': { lat: -7.2152, lng: 111.9062 },
  'mojokerto': { lat: -7.4725, lng: 112.4397 },
  'gresik': { lat: -7.1579, lng: 112.6641 },
  'lamongan': { lat: -6.9800, lng: 112.4100 },
  'tuban': { lat: -6.8940, lng: 112.7491 },
  'bojonegoro': { lat: -7.1519, lng: 111.8832 },
  'cirebon': { lat: -6.7031, lng: 108.4487 },
  'tasikmalaya': { lat: -7.3283, lng: 108.2159 },
  'garut': { lat: -7.2333, lng: 107.9000 },
  'sukabumi': { lat: -6.9271, lng: 106.9280 },
  'ciamis': { lat: -7.3571, lng: 108.3395 },
  'salatiga': { lat: -7.3277, lng: 110.5051 },
  'purwokerto': { lat: -7.4316, lng: 109.2398 },
  'pekalongan': { lat: -6.8889, lng: 109.6789 },
  'kudus': { lat: -6.9071, lng: 110.8381 },
  'jepara': { lat: -6.8602, lng: 110.6748 },
  'pati': { lat: -6.7667, lng: 111.1167 },
  'demak': { lat: -6.8833, lng: 110.6333 },
  'wonosobo': { lat: -7.3500, lng: 107.5833 },
};

function translateCityName(city) {
  const lower = city.toLowerCase().trim();
  return cityTranslationMap[lower] || city;
}

async function getWeatherOpenWeather(city) {
  try {
    const apiKey = process.env.OPENWEATHER_KEY;
    if (!apiKey) throw new Error('OPENWEATHER_KEY not set');
    
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=id`
    );
    
    if (!res.ok) {
      if (res.status === 404) throw new Error('not_found');
      throw new Error(`HTTP ${res.status}`);
    }
    
    const data = await res.json();
    return {
      success: true,
      city: data.name,
      country: data.sys.country,
      temp: Math.round(data.main.temp),
      feels: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      windSpeed: Math.round(data.wind.speed * 3.6),
      condition: data.weather[0].main,
      description: data.weather[0].description,
      icon: data.weather[0].icon,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getWeatherWttr(city) {
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    const rawText = await res.text();
    const data = JSON.parse(rawText);
    
    if (!data.current_condition?.[0] || !data.nearest_area?.[0]) {
      throw new Error('invalid_data');
    }
    
    const cur = data.current_condition[0];
    const area = data.nearest_area[0];
    
    return {
      success: true,
      city: area.areaName[0].value,
      country: area.country[0].value,
      temp: cur.temp_C,
      feels: cur.FeelsLikeC,
      humidity: cur.humidity,
      windSpeed: cur.windspeedKmph,
      condition: cur.weatherDesc[0].value,
      description: cur.weatherDesc[0].value,
      icon: 'wttr',
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getWeatherByCoordinates(lat, lng) {
  try {
    const apiKey = process.env.OPENWEATHER_KEY;
    if (!apiKey) throw new Error('OPENWEATHER_KEY not set');
    
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric&lang=id`
    );
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();
    return {
      success: true,
      city: data.name,
      country: data.sys.country,
      temp: Math.round(data.main.temp),
      feels: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      windSpeed: Math.round(data.wind.speed * 3.6),
      condition: data.weather[0].main,
      description: data.weather[0].description,
      icon: data.weather[0].icon,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getWeatherEmoji(condition) {
  const cond = condition.toLowerCase();
  if (cond.includes('rain') || cond.includes('hujan')) return '🌧️';
  if (cond.includes('cloud') || cond.includes('mendung')) return '☁️';
  if (cond.includes('sunny') || cond.includes('cerah')) return '☀️';
  if (cond.includes('thunder') || cond.includes('petir')) return '⛈️';
  if (cond.includes('snow') || cond.includes('salju')) return '❄️';
  if (cond.includes('clear')) return '🌙';
  return '🌤️';
}

async function fetchWeather(city) {
  // Check cache
  const cached = weatherCache.get(city.toLowerCase());
  if (cached && Date.now() < cached.expiry) {
    return cached.data;
  }

  // Try OpenWeatherMap first
  let result = await getWeatherOpenWeather(city);
  
  // Fallback to wttr.in jika gagal
  if (!result.success) {
    result = await getWeatherWttr(city);
  }

  // Fallback to coordinates jika masih gagal
  if (!result.success) {
    const coords = cityCoordinates[city.toLowerCase()];
    if (coords) {
      result = await getWeatherByCoordinates(coords.lat, coords.lng);
    }
  }

  // Cache hasil (10 menit)
  if (result.success) {
    weatherCache.set(city.toLowerCase(), {
      data: result,
      expiry: Date.now() + 10 * 60 * 1000,
    });
  }

  return result;
}

// ============================
//   EVENT: BOT SIAP
// ============================
client.once('ready', async () => {
  console.log(`✅ Bot online sebagai: ${client.user.tag}`);
  console.log(`🌐 Terhubung ke ${client.guilds.cache.size} server`);
  console.log(`🔍 Search engine: ${process.env.SERPAPI_KEY ? 'SerpApi (Google) + DuckDuckGo fallback' : 'DuckDuckGo only'}`);

  // Register slash commands
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
    console.log('✅ Slash commands registered!');
  } catch (e) {
    console.error('❌ Gagal register slash commands:', e.message);
  }
});

// ============================
//   EVENT: PESAN MASUK
// ============================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();
  const isMentioned = message.mentions.has(client.user);
  const lower = content.toLowerCase();
  const P = matchPrefix(content, message.guild?.id);
  if (!P && !isMentioned) return;
  const cmd = P ? content.slice(P.length).trim() : '';
  const cmdLower = cmd.toLowerCase();

  // --- !help ---
  if (cmdLower === 'help') {
    return message.reply(
      `📖 **Cara Pakai ${BOT_NAME}** (prefix: \`${P}\`)\n\n` +
      `💬 \`!ai <pertanyaan>\` — Tanya AI\n` +
      `🔍 \`!cari <query>\` — Cari di internet\n` +
      `🎨 \`!image <deskripsi>\` — Generate gambar\n` +
      `🌐 \`!terjemah <bahasa> <teks>\` — Translate teks\n` +
      `☀️ \`!cuaca <kota>\` — Info cuaca\n` +
      `🧮 \`!hitung <ekspresi>\` — Kalkulator\n` +
      `💡 \`!quote\` — Kutipan motivasi\n` +
      `📝 \`!ringkas <teks>\` — Ringkas teks panjang\n` +
      `🔥 \`!roast @user\` — Roast seseorang\n` +
      `🗞️ \`!gosip @user\` — Gosip absurd tentang user\n` +
      `💘 \`!ship @user1 @user2\` — Cek kecocokan dua orang\n` +
      `⚖️ \`!compatibility @user1 @user2\` — Laporan kompatibilitas\n` +
      `🖼️ \`!pp [@user]\` — Lihat foto profil\n` +
      `♈ \`!horoscope <zodiak>\` — Ramalan bintang harian\n` +
      `🔊 \`!tts <teks>\` — Convert teks ke suara\n` +
      `🎲 \`!tebak\` — Game tebak angka 1-100\n` +
      `🧠 \`!kuis\` — Trivia & \`!jawab\` untuk menjawab\n` +
      `🎯 \`!truth\` — Pertanyaan truth random\n` +
      `🔥 \`!dare\` — Challenge dare random\n` +
      `🔮 \`!tarot\` — Ramalan tarot 3 kartu\n` +
      `📖 \`!cerita <tema>\` — Bikin cerita pendek\n` +
      `💙 \`!curhat <isi>\` — Curhat ke AI\n` +
      `📍 \`!lokasi <kota>\` — Set lokasi kamu\n` +
      `🕌 \`!jadwal\` — Jadwal sholat & Ramadan (auto hapus 2 menit)\n` +
      `🏓 \`!ping\` — Cek latency bot\n` +
      `🔄 \`!reset\` — Reset history chat\n\n` +
      `> 🤖 Dibuat oleh **${CREATOR}**`
    );
  }

  // --- !lokasi ---
  if (cmdLower.startsWith('lokasi ')) {
    const kota = cmd.slice(7).trim();
    if (!kota) return message.reply('❌ Tulis nama kotanya! Contoh: `!lokasi Jakarta`');
    userLocations.set(message.author.id, kota);
    return message.reply(`✅ Lokasi kamu disimpan: **${kota}**\nSekarang ketik \`!jadwal\` untuk lihat jadwal sholat! 🕌`);
  }

  // --- !jadwal ---
  if (cmdLower === 'jadwal' || cmdLower.startsWith('jadwal ')) {
    const kotaInput = cmd.slice(7).trim();
    const kota = kotaInput || userLocations.get(message.author.id);
    if (!kota) {
      return message.reply('❌ Tulis kotamu atau set lokasi dulu!\nContoh langsung: `!jadwal Serang`\nAtau simpan dulu: `!lokasi Serang` lalu `!jadwal`');
    }
    const stopTyping = keepTyping(message.channel);
    try {
      const timings = await getJadwalSholat(kota);
      const msg = formatJadwal(kota, timings);
      const sent = await message.reply(msg);
      setTimeout(async () => {
        try { await sent.delete(); } catch {}
        try { await message.delete(); } catch {}
      }, 60 * 1000);
      return;
    } catch (e) {
      console.error('❌ Error jadwal:', e.message);
      return message.reply(`❌ Kota **${kota}** tidak ditemukan. Coba pakai nama kota terdekat ya!`);
    } finally { stopTyping(); }
  }

  // --- !ping ---
  if (cmdLower === 'ping') {
    const sent = await message.reply('🏓 Pinging...');
    const latency = sent.createdTimestamp - message.createdTimestamp;
    return sent.edit(
      `🏓 **Pong!**\n\n` +
      `📡 Bot Latency: **${latency}ms**\n` +
      `💓 WebSocket: **${client.ws.ping}ms**`
    );
  }

  // --- !reset ---
  if (cmdLower === 'reset') {
    conversations.delete(message.author.id);
    return message.reply('✅ History percakapan kamu sudah direset!');
  }

  // --- !quote ---
  if (cmdLower === 'quote') {
    let q, source = '🌐';
    try {
      q = await fetchOnlineQuote();
      q.text = await translateText(q.text, 'Indonesia');
    } catch {
      q = quotesOffline[Math.floor(Math.random() * quotesOffline.length)];
      source = '📦';
    }
    return message.reply(
      `💡 **Quote of the moment** ${source}\n\n` +
      `*"${q.text}"*\n` +
      `— **${q.author}**`
    );
  }

  // --- !hitung ---
  if (cmdLower.startsWith('hitung ')) {
    const expr = cmd.slice(7).trim();
    try {
      if (!/^[0-9+\-*/.() %^]+$/.test(expr)) {
        return message.reply('❌ Ekspresi tidak valid! Contoh: `!hitung 10 * 5 + 3`');
      }
      const result = Function('"use strict"; return (' + expr + ')')();
      if (!isFinite(result)) return message.reply('❌ Hasil tidak valid (mungkin pembagian dengan nol?)');
      return message.reply(
        `🧮 **Kalkulator**\n\n📥 Input: \`${expr}\`\n📤 Hasil: \`${result}\``
      );
    } catch {
      return message.reply('❌ Ekspresi tidak valid. Contoh: `!hitung 10 * 5 + 3`');
    }
  }

  // --- !cuaca ---
  if (cmdLower.startsWith('cuaca ')) {
    const kotaInput = cmd.slice(6).trim();
    if (!kotaInput) return message.reply('❌ Tulis nama kotanya ya! Contoh: `!cuaca Semarang`');
    
    const kota = translateCityName(kotaInput);
    const stopTyping = keepTyping(message.channel);
    
    try {
      const weather = await fetchWeather(kota);
      
      if (!weather.success) {
        return message.reply(
          `❌ Kota **${kotaInput}** tidak ditemukan.\n\n` +
          `💡 Coba dengan nama kota yang lebih lengkap atau dalam Bahasa Inggris.\n` +
          `📝 Contoh: \`!cuaca Jakarta\`, \`!cuaca Semarang\`, \`!cuaca Yogyakarta\``
        );
      }

      const emoji = getWeatherEmoji(weather.condition);
      return message.reply(
        `${emoji} **Cuaca di ${weather.city}, ${weather.country}**\n\n` +
        `🌡️ Suhu: **${weather.temp}°C** (terasa ${weather.feels}°C)\n` +
        `🌤️ Kondisi: **${weather.description || weather.condition}**\n` +
        `💧 Kelembaban: **${weather.humidity}%**\n` +
        `💨 Angin: **${weather.windSpeed} km/h**\n\n` +
        `> 📡 *Data dari OpenWeatherMap*`
      );
    } catch (e) {
      console.error('❌ Error cuaca:', e.message);
      return message.reply('❌ Gagal mengambil data cuaca. Coba lagi!');
    } finally { stopTyping(); }
  }

  // --- !terjemah ---
  if (cmdLower.startsWith('terjemah ')) {
    const args = cmd.slice(9).trim();
    const spaceIdx = args.indexOf(' ');
    if (spaceIdx === -1) return message.reply('❌ Format: `!terjemah <bahasa> <teks>`\nContoh: `!terjemah inggris Halo dunia`');
    const targetLang = args.slice(0, spaceIdx);
    const text = args.slice(spaceIdx + 1);
    const stopTyping = keepTyping(message.channel);
    try {
      const result = await translateText(text, targetLang);
      return message.reply(
        `🌐 **Terjemahan ke ${targetLang}**\n\n📥 Asli: *${text}*\n📤 Hasil: **${result}**`
      );
    } catch (e) {
      console.error('❌ Error terjemah:', e.message);
      return message.reply('❌ Gagal menerjemahkan. Coba lagi ya!');
    } finally { stopTyping(); }
  }

  // --- !image ---
  if (cmdLower.startsWith('image ')) {
    const prompt = cmd.slice(6).trim();
    if (!prompt) return message.reply('Tulis deskripsi gambarnya ya! Contoh: `!image kucing lucu memakai topi` 🎨');
    const stopTyping = keepTyping(message.channel);
    try {
      const encodedPrompt = encodeURIComponent(prompt);
      const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true`;
      let attachment;
      try {
        const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
        if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        attachment = new AttachmentBuilder(buffer, { name: 'generated.png' });
      } catch {
        return message.reply({
          content:
            `🎨 **Generate Image**\n\n**Prompt:** ${prompt}\n` +
            `${imageUrl}`,
        });
      }
      return message.reply({
        content: `🎨 **Generate Image**\n\n**Prompt:** ${prompt}`,
        files: [attachment],
      });
    } catch (e) {
      console.error('❌ Error image:', e.message);
      return message.reply('❌ Gagal generate gambar. Coba lagi ya!');
    } finally { stopTyping(); }
  }

  // --- !cari ---
  if (cmdLower.startsWith('cari ')) {
    const query = cmd.slice(5).trim();
    if (!query) return message.reply('❌ Tulis kata pencariannya ya! Contoh: `!cari presiden Indonesia 2024`');
    const stopTyping = keepTyping(message.channel);
    try {
      const { results, engine } = await searchWeb(query);
      const ringkasan = await rangkumHasilCari(query, results);
      const sumber = [...new Set(results.map(r => r.source))].slice(0, 3);
      return message.reply(
        `🔍 **Hasil Pencarian** ${engine}\n` +
        `📝 Query: *${query}*\n\n` +
        `📋 **Ringkasan:**\n${ringkasan}\n\n` +
        `🌐 **Sumber:**\n${sumber.map(s => `• ${s}`).join('\n')}`
      );
    } catch (e) {
      console.error('❌ Error cari:', e.message);
      return message.reply(`❌ Tidak ada hasil untuk **"${query}"**. Coba kata kunci lain ya!`);
    } finally { stopTyping(); }
  }

  // --- !ringkas ---
  if (cmdLower.startsWith('ringkas ')) {
    const text = cmd.slice(8).trim();
    if (!text) return message.reply('❌ Tulis teks yang mau diringkas!');
    if (text.length < 50) return message.reply('❌ Teksnya terlalu pendek untuk diringkas!');
    const stopTyping = keepTyping(message.channel);
    try {
      const result = await ringkasText(text);
      return message.reply(`📝 **Ringkasan**\n\n${result}`);
    } catch (e) {
      console.error('❌ Error ringkas:', e.message);
      return message.reply('❌ Gagal meringkas. Coba lagi ya!');
    } finally { stopTyping(); }
  }

  // --- !roast ---
  if (cmdLower.startsWith('roast')) {
    const mentionedUser = message.mentions.users.first();
    if (!mentionedUser) return message.reply("❌ Mention orangnya ya! Contoh: `!roast @user`");
    const targetName = mentionedUser.username;
    const display = `<@${mentionedUser.id}>`;
    if (mentionedUser.id === CREATOR_ID) {
      const stopTyping = keepTyping(message.channel);
      try {
        const res = await ollama.chat({
          model: OLLAMA_MODEL,
          messages: [
            { role: "system", content: "Kamu adalah sahabat dekat Jamal, seorang developer muda keren. Buat 4-5 kalimat pujian yang personal, natural, dan tulus seperti dari teman dekat. Sebut namanya Jamal. Bahasa gaul Indonesia yang santai. Langsung tulis pujiannya." },
            { role: "user", content: "Puji Jamal dengan cara yang personal, natural, dan bikin dia senyum!" },
          ],
          stream: false,
        });
        return message.reply(`✨ **Spesial untuk ${display}**\n\n${res.message.content}`);
      } catch (e) {
        return message.reply("❌ Gagal. Coba lagi ya!");
      } finally { stopTyping(); }
    }
    const result = roastUser(targetName);
    return message.reply(`🔥 **Roast untuk ${display}**\n\n${result}`);
  }

  // --- !tebak (mulai game) ---
  if (cmdLower === 'tebak') {
    tebakGames.set(message.author.id, { angka: Math.floor(Math.random() * 100) + 1, attempts: 0 });
    return message.reply(
      `🎲 **Game Tebak Angka dimulai!**\n\n` +
      `Aku sudah pilih angka antara **1 - 100**.\n` +
      `Ketik \`!tebak <angka>\` untuk menebak.\n` +
      `Ketik \`!tebak stop\` untuk menyerah.`
    );
  }

  // --- !tebak <angka> ---
  if (cmdLower.startsWith('tebak ')) {
    const input = cmd.slice(6).trim().toLowerCase();
    if (input === 'stop') {
      const game = tebakGames.get(message.author.id);
      if (!game) return message.reply('❌ Kamu belum mulai game! Ketik `!tebak` dulu.');
      tebakGames.delete(message.author.id);
      return message.reply(`🏳️ Kamu menyerah! Jawabannya adalah **${game.angka}**. Coba lagi dengan \`!tebak\`!`);
    }
    const tebakan = parseInt(input);
    if (isNaN(tebakan) || tebakan < 1 || tebakan > 100) return message.reply('❌ Masukkan angka antara 1 sampai 100!');
    const game = tebakGames.get(message.author.id);
    if (!game) return message.reply('❌ Kamu belum mulai game! Ketik `!tebak` dulu.');
    game.attempts++;
    if (tebakan === game.angka) {
      tebakGames.delete(message.author.id);
      return message.reply(`🎉 **BENAR!** Jawabannya memang **${game.angka}**!\nKamu berhasil dalam **${game.attempts} tebakan**! 🏆\nMain lagi? Ketik \`!tebak\`!`);
    }
    const hint = tebakan < game.angka ? '📈 Terlalu kecil!' : '📉 Terlalu besar!';
    return message.reply(`${hint} Tebakan ke-**${game.attempts}**. Coba lagi!`);
  }

  // --- !kuis ---
  if (cmdLower === 'kuis') {
    if (kuisGames.has(message.author.id)) {
      const ex = kuisGames.get(message.author.id);
      return message.reply(`❓ Masih ada soal aktif!\n\n**${ex.soal}**\n\nJawab dengan \`!jawab <jawaban>\` atau \`!kuis skip\` untuk soal baru.`);
    }
    const stopTyping = keepTyping(message.channel);
    try {
      const kuis = await generateKuis();
      kuisGames.set(message.author.id, kuis);
      return message.reply(`🧠 **Trivia Time!**\n\n❓ **${kuis.soal}**\n\nKetik \`!jawab <jawabanmu>\` untuk menjawab!\nAtau \`!kuis skip\` untuk soal lain.`);
    } catch (e) {
      console.error('❌ Error kuis:', e.message);
      return message.reply('❌ Gagal bikin soal. Coba lagi ya!');
    } finally { stopTyping(); }
  }

  if (lower === `${P}kuis skip`) {
    kuisGames.delete(message.author.id);
    return message.reply('⏭️ Soal diskip! Ketik `!kuis` untuk soal baru.');
  }

  // --- !jawab ---
  if (cmdLower.startsWith('jawab ')) {
    const game = kuisGames.get(message.author.id);
    if (!game) return message.reply('❌ Belum ada soal aktif! Ketik `!kuis` dulu.');
    const jawaban = cmd.slice(6).trim().toLowerCase();
    const correct = jawaban.includes(game.jawaban) || game.jawaban.includes(jawaban);
    kuisGames.delete(message.author.id);
    if (correct) {
      return message.reply(`✅ **BENAR!** 🎉\nJawaban: **${game.jawaban}**\n\nMau soal lagi? Ketik \`!kuis\`!`);
    } else {
      return message.reply(`❌ **Salah!**\nJawabanmu: *${jawaban}*\nJawaban benar: **${game.jawaban}**\n\nCoba lagi? Ketik \`!kuis\`!`);
    }
  }

  // --- !truth ---
  if (cmdLower === 'truth') {
    const stopTyping = keepTyping(message.channel);
    try {
      const pertanyaan = await generateTruth();
      return message.reply(`🎯 **Truth untuk ${message.author.username}**\n\n*"${pertanyaan}"*\n\n> Harus jujur ya! 😏`);
    } catch (e) {
      console.error('❌ Error truth:', e.message);
      return message.reply('❌ Gagal generate pertanyaan. Coba lagi ya!');
    } finally { stopTyping(); }
  }

  // --- !dare ---
  if (cmdLower === 'dare') {
    const stopTyping = keepTyping(message.channel);
    try {
      const challenge = await generateDare();
      return message.reply(`🔥 **Dare untuk ${message.author.username}**\n\n*"${challenge}"*\n\n> Jangan takut ya! 😈`);
    } catch (e) {
      console.error('❌ Error dare:', e.message);
      return message.reply('❌ Gagal generate challenge. Coba lagi ya!');
    } finally { stopTyping(); }
  }

  // --- !tarot ---
  if (cmdLower === 'tarot') {
    const stopTyping = keepTyping(message.channel);
    try {
      const { past, present, future, reading } = await generateTarot(message.author.username);
      const buffer = await generateTarotImage(past, present, future, message.author.username);
      const tarotMsg =
        `🔮 **Ramalan Tarot untuk ${message.author.username}**\n\n` +
        `> ${past.emoji} **${past.name}**\n> *${past.meaning}*\n\n` +
        `> ${present.emoji} **${present.name}**\n> *${present.meaning}*\n\n` +
        `> ${future.emoji} **${future.name}**\n> *${future.meaning}*\n\n` +
        `✨ **Ramalan:**\n${reading}`;
      if (buffer) {
        const attachment = new AttachmentBuilder(buffer, { name: 'tarot.png' });
        return message.reply({ content: tarotMsg, files: [attachment] });
      }
      return message.reply(tarotMsg);
    } catch (e) {
      console.error('❌ Error tarot:', e.message);
      return message.reply('❌ Gagal baca tarot. Coba lagi ya!');
    } finally { stopTyping(); }
  }

  // --- !cerita ---
  if (cmdLower.startsWith('cerita ')) {
    const tema = cmd.slice(7).trim();
    if (!tema) return message.reply('❌ Tulis temanya ya! Contoh: `!cerita persahabatan di luar angkasa`');
    const stopTyping = keepTyping(message.channel);
    try {
      const cerita = await generateCerita(tema);
      const chunks = splitMessage(`📖 **Cerita: ${tema}**\n\n${cerita}`);
      if (chunks.length === 1) await message.reply(chunks[0]);
      else for (const chunk of chunks) await message.channel.send(chunk);
      return;
    } catch (e) {
      console.error('❌ Error cerita:', e.message);
      return message.reply('❌ Gagal bikin cerita. Coba lagi ya!');
    } finally { stopTyping(); }
  }

  // --- !curhat ---
  if (cmdLower.startsWith('curhat ')) {
    const isi = cmd.slice(7).trim();
    if (!isi) return message.reply('❌ Tulis curhatanmu ya! Contoh: `!curhat aku lagi sedih banget...`');
    const stopTyping = keepTyping(message.channel);
    try {
      const respons = await generateCurhat(isi);
      const chunks = splitMessage(`💙 **NEO AI mendengarkanmu...**\n\n${respons}`);
      if (chunks.length === 1) await message.reply(chunks[0]);
      else for (const chunk of chunks) await message.channel.send(chunk);
      return;
    } catch (e) {
      console.error('❌ Error curhat:', e.message);
      return message.reply('❌ Gagal merespons. Coba lagi ya!');
    } finally { stopTyping(); }
  }

  // --- !pp ---
  if (cmdLower.startsWith('pp') || cmdLower === 'pp') {
    try {
      let target = message.mentions.users.first();
      if (!target) {
        const mentionMatch = cmd.match(/<@!?(\d+)>/);
        if (mentionMatch) {
          try { target = await client.users.fetch(mentionMatch[1]); } catch {}
        }
      }
      target = target || message.author;
      const avatarURL = target.displayAvatarURL({ size: 512, extension: 'png', forceStatic: false });
      const { EmbedBuilder } = require('discord.js');
      const embed = new EmbedBuilder()
        .setTitle(`🖼️ Foto profil ${target.username}`)
        .setImage(avatarURL)
        .setColor(0x5865F2);
      return message.reply({ embeds: [embed] });
    } catch (e) {
      console.error('❌ Error pp:', e.message);
      return message.reply('❌ Gagal ambil foto profil. Coba lagi!');
    }
  }

  // --- !ship ---
  if (cmdLower.startsWith('ship ')) {
    const users = [...message.mentions.users.values()];
    if (users.length < 2) return message.reply('❌ Mention 2 orang! Contoh: `!ship @user1 @user2`');
    const [u1, u2] = users;
    const seed = (u1.id + u2.id).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const pct = seed % 101;
    const emoji = pct >= 80 ? '💘' : pct >= 50 ? '💛' : pct >= 30 ? '🤝' : '💔';
    const getKomen = (p) => {
      if (p >= 80) return ['Jodoh banget nih! 💘', 'Udah takdir kayaknya 😍', 'Ini match yang sempurna! 🔥', 'Nikah aja sekalian! 💍'][Math.floor(Math.random()*4)];
      if (p >= 50) return ['Lumayan cocok sih 😏', 'Ada potensi nih~', 'Chemistry-nya lumayan! ✨'][Math.floor(Math.random()*3)];
      if (p >= 30) return ['Masih bisa diusahain 😅', 'Effort dulu baru hasil!', 'Jangan nyerah! 💪'][Math.floor(Math.random()*3)];
      return ['Mending mundur teratur 😂', 'Bukan jodohnya kali 💔', 'Alien sama manusia lebih cocok 👽'][Math.floor(Math.random()*3)];
    };
    const stopTyping = keepTyping(message.channel);
    try {
      const komen = await generateShipKomen(u1.username, u2.username, pct);
      const loveEmoji = pct >= 80 ? '💖' : pct >= 60 ? '💗' : pct >= 40 ? '💛' : pct >= 20 ? '💙' : '💔';
      const header = `${loveEmoji} **<@${u1.id}> + <@${u2.id}> = ${pct}% of Love** ${loveEmoji}`;
      const av1 = u1.displayAvatarURL({ size: 256, extension: 'png', forceStatic: true });
      const av2 = u2.displayAvatarURL({ size: 256, extension: 'png', forceStatic: true });
      const buffer = await generateShipImage(av1, av2, pct, u1.username, u2.username);
      if (buffer) {
        const attachment = new AttachmentBuilder(buffer, { name: 'ship.png' });
        return message.reply({ content: `${header}\n${komen}`, files: [attachment] });
      }
      return message.reply(`${header}\n${komen}`);
    } catch (e) { console.warn('Ship failed:', e.message); }
    finally { stopTyping(); }
  }

  // --- !compatibility ---
  if (cmdLower.startsWith('compatibility ')) {
    const users = [...message.mentions.users.values()];
    if (users.length < 2) return message.reply('❌ Mention 2 orang! Contoh: `!compatibility @user1 @user2`');
    const [u1, u2] = users;
    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const drama = rand(1, 100), kerja = rand(1, 100), komik = rand(1, 100), friend = rand(1, 100), asmara = rand(1, 100);
    const overall = Math.floor((drama + kerja + komik + friend + asmara) / 5);
    const emoji = overall >= 80 ? '💘' : overall >= 60 ? '💛' : overall >= 40 ? '🤝' : '💔';
    const komen = overall >= 80 ? 'Kalian terlalu cocok, ini suspicious 👀' : overall >= 60 ? 'Solid! Tapi jangan baper ya 😄' : overall >= 40 ? 'Bisa diusahain kalau mau 😅' : 'Kalian lebih cocok jadi musuh 😂';
    return message.reply(`${emoji} **Compatibility: ${u1.username} & ${u2.username}**\n\n😂 Drama Potential: **${drama}%**\n🤝 Kerja Sama: **${kerja}%**\n😂 Kelucuan: **${komik}%**\n👫 Friendship: **${friend}%**\n💑 Asmara: **${asmara}%**\n\n**Overall: ${overall}%**\n*${komen}*`);
  }

  // --- !marry ---
  if (cmdLower.startsWith('marry ')) {
    const target = message.mentions.users.first();
    if (!target) return message.reply('❌ Mention orangnya! Contoh: `!marry @user`');
    if (target.id === message.author.id) return message.reply('❌ Gak bisa nikah sama diri sendiri! 😂');
    if (marriages.has(message.author.id)) {
      const currentSpouse = marriages.get(message.author.id);
      return message.reply(`❌ Kamu sudah menikah dengan <@${currentSpouse}>! Cerai dulu pakai \`!divorce\` 😂`);
    }
    marriages.set(message.author.id, target.id);
    marriages.set(target.id, message.author.id);
    return message.reply(`💍 **SURAT NIKAH RESMI**\n\nDengan ini **${message.author.username}** dan **${target.username}** resmi menikah! 🎉\nSemoga langgeng dan jangan berantem soal siapa yang cuci piring! 😂\n\n*(Ditandatangani oleh NEO AI)*`);
  }

  // --- !divorce ---
  if (cmdLower === 'divorce' || cmdLower.startsWith('divorce ')) {
    if (!marriages.has(message.author.id)) return message.reply('❌ Kamu belum menikah! 😂');
    const spouseId = marriages.get(message.author.id);
    marriages.delete(message.author.id);
    marriages.delete(spouseId);
    return message.reply(`💔 **CERAI RESMI**\n\n**${message.author.username}** dan <@${spouseId}> resmi bercerai...\nSemoga move on dengan cepat! 😂`);
  }

  // --- !gosip ---
  if (cmdLower.startsWith('gosip ')) {
    const target = message.mentions.users.first();
    if (!target) return message.reply('❌ Mention orangnya! Contoh: `!gosip @user`');
    const stopTyping = keepTyping(message.channel);
    try {
      const res = await ollama.chat({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: 'Kamu adalah reporter gosip Discord yang lebay dan dramatis. Buat 2-3 kalimat gosip random yang absurd, lucu, dan tidak masuk akal tentang seseorang. Gaya breaking news TV. Bahasa gaul Indonesia. Langsung tulis gosipnya.' },
          { role: 'user', content: `Buat gosip lucu dan absurd tentang user Discord bernama "${target.username}"` },
        ],
        stream: false,
      });
      return message.reply(`🗞️ **BREAKING NEWS!**\n\n${res.message.content}`);
    } catch (e) {
      return message.reply('❌ Gagal bikin gosip. Coba lagi!');
    } finally { stopTyping(); }
  }

  // --- !horoscope ---
  if (cmdLower.startsWith('horoscope ')) {
    const zodiak = cmd.slice(10).trim().toLowerCase();
    const validZodiak = ['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'];
    const emojiMap = { aries:'♈',taurus:'♉',gemini:'♊',cancer:'♋',leo:'♌',virgo:'♍',libra:'♎',scorpio:'♏',sagittarius:'♐',capricorn:'♑',aquarius:'♒',pisces:'♓' };
    if (!validZodiak.includes(zodiak)) return message.reply(`❌ Zodiak tidak valid! Pilih: ${validZodiak.join(', ')}`);
    const stopTyping = keepTyping(message.channel);
    try {
      const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
      const tgl = `${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()}`;
      const res = await ollama.chat({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: 'Kamu adalah astrolog Discord yang seru dan santai. Buat ramalan bintang harian yang menarik dan positif. Format: 3-4 kalimat ramalan, lalu baris baru "Keberuntungan: ⭐⭐⭐ (1-5 bintang)", "Warna hari ini: [warna]", "Angka keberuntungan: [angka]". Bahasa gaul Indonesia.' },
          { role: 'user', content: `Buat ramalan harian untuk zodiak ${zodiak} pada tanggal ${tgl}` },
        ],
        stream: false,
      });
      return message.reply(`${emojiMap[zodiak]} **${zodiak.charAt(0).toUpperCase()+zodiak.slice(1)} — ${tgl}**\n\n${res.message.content}`);
    } catch (e) {
      return message.reply('❌ Gagal ambil ramalan. Coba lagi!');
    } finally { stopTyping(); }
  }

  // --- !tts ---
  if (cmdLower.startsWith('tts ')) {
    const teks = cmd.slice(4).trim();
    if (!teks) return message.reply('❌ Tulis teksnya! Contoh: `!tts Halo semuanya`');
    if (teks.length > 200) return message.reply('❌ Teks terlalu panjang! Maksimal 200 karakter.');
    const stopTyping = keepTyping(message.channel);
    try {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(teks)}&tl=id&client=tw-ob`;
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!response.ok) throw new Error('TTS gagal');
      const buffer = Buffer.from(await response.arrayBuffer());
      const { AttachmentBuilder } = require('discord.js');
      const attachment = new AttachmentBuilder(buffer, { name: 'tts.mp3' });
      return message.reply({ content: `🔊 **TTS:** ${teks}`, files: [attachment] });
    } catch (e) {
      console.error('❌ TTS error:', e.message);
      return message.reply('❌ Gagal generate TTS. Coba lagi!');
    } finally { stopTyping(); }
  }

  // --- PREFIX MANAGEMENT (hanya Tuan) ---
  if (cmdLower.startsWith('setprefix ')) {
    if (message.author.id !== CREATOR_ID) return message.reply('❌ Hanya Tuan yang bisa mengubah prefix!');
    const newP = cmd.slice(10).trim();
    if (!newP || newP.length > 3) return message.reply('❌ Prefix tidak valid! Maksimal 3 karakter.');
    guildPrefixes.set(message.guild?.id, new Set([newP, '!']));
    savePrefixes();
    const active = [...getPrefixes(message.guild?.id)].join(', ');
    return message.reply('✅ Prefix utama diubah ke **' + newP + '**\nPrefix aktif: **' + active + '**');
  }

  if (cmdLower.startsWith('addprefix ')) {
    if (message.author.id !== CREATOR_ID) return message.reply('❌ Hanya Tuan yang bisa mengubah prefix!');
    const addP = cmd.slice(10).trim();
    if (!addP || addP.length > 3) return message.reply('❌ Prefix tidak valid! Maksimal 3 karakter.');
    const prefixes = getPrefixes(message.guild?.id);
    if (prefixes.size >= 5) return message.reply('❌ Maksimal 5 prefix sekaligus!');
    prefixes.add(addP);
    savePrefixes();
    return message.reply('✅ Prefix **' + addP + '** ditambahkan!\nPrefix aktif: **' + [...prefixes].join(', ') + '**');
  }

  if (cmdLower.startsWith('removeprefix ')) {
    if (message.author.id !== CREATOR_ID) return message.reply('❌ Hanya Tuan yang bisa mengubah prefix!');
    const removeP = cmd.slice(13).trim();
    const prefixes = getPrefixes(message.guild?.id);
    if (prefixes.size <= 1) return message.reply('❌ Harus ada minimal 1 prefix yang aktif!');
    if (!prefixes.has(removeP)) return message.reply('❌ Prefix **' + removeP + '** tidak ada!');
    prefixes.delete(removeP);
    savePrefixes();
    return message.reply('✅ Prefix **' + removeP + '** dihapus!\nPrefix aktif: **' + [...prefixes].join(', ') + '**');
  }

  if (cmdLower === 'prefix') {
    const prefixes = getPrefixes(message.guild?.id);
    const list = [...prefixes].map(p => '`' + p + '`').join(', ');
    return message.reply('📌 **Prefix aktif:** ' + list);
  }

  // --- !ai atau mention ---
  let userText = '';
  if (cmdLower.startsWith('ai ') || cmdLower === 'ai') {
    userText = cmd.slice(3).trim();
  } else if (isMentioned) {
    userText = content.replace(`<@${client.user.id}>`, '').trim();

    const curhatKeywords = [
      'sedih', 'galau', 'nangis', 'stress', 'stres', 'capek', 'lelah',
      'kecewa', 'marah', 'kesal', 'bingung', 'takut', 'cemas', 'khawatir',
      'putus asa', 'menyerah', 'gagal', 'sakit hati', 'patah hati', 'broken',
      'down', 'hopeless', 'lonely', 'sendirian', 'kesepian', 'curhat',
      'cerita', 'isi hati', 'pengen nangis', 'ngerasa', 'perasaan',
    ];
    const isCurhatMode = curhatKeywords.some(k => lower.includes(k));

    if (isCurhatMode && userText) {
      const stopTyping = keepTyping(message.channel);
      try {
        const respons = await generateCurhat(userText);
        const chunks = splitMessage(`💙 **NEO AI mendengarkanmu...**\n\n${respons}`);
        if (chunks.length === 1) await message.reply(chunks[0]);
        else for (const chunk of chunks) await message.channel.send(chunk);
        return;
      } catch (e) {
        console.error('❌ Error curhat mention:', e.message);
        return message.reply('❌ Gagal merespons. Coba lagi ya!');
      } finally { stopTyping(); }
    }
  } else {
    return;
  }

  if (!userText) return message.reply('Hei! Tulis pertanyaanmu ya. Contoh: `!ai siapa kamu?` 😊');

  const stopTyping = keepTyping(message.channel);
  try {
    const userId = message.author.id;
    if (!conversations.has(userId)) conversations.set(userId, []);
    const history = conversations.get(userId);

    const isCreator = message.author.id === CREATOR_ID;

    // Auto-detect nickname dari pesan user
    const detectedNick = detectNickname(userText);
    if (detectedNick) {
      nicknames.set(userId, detectedNick);
      saveNicknames();
      console.log(`💾 Nickname saved: ${message.author.username} → ${detectedNick}`);
    }
    const nickname = nicknames.get(userId) || null;

    history.push({ role: 'user', content: `[Pesan dari user Discord: ${message.author.username}] ${userText}` });
    const reply = await askAI(history, { nickname, isCreator });
    history.push({ role: 'assistant', content: reply });
    if (history.length > MAX_HISTORY) history.splice(0, 2);

    const htmlContent = extractHTML(reply);
    let finalReply;
    if (htmlContent) {
      const previewId = generatePreviewId();
      previews.set(previewId, { html: htmlContent, createdAt: Date.now() });
      const previewLink = `${PREVIEW_DOMAIN}/preview/${previewId}`;
      finalReply = `${formatResponse(reply)}\n\n🌐 **Preview:** ${previewLink}\n> ⏳ *Link expired dalam 1 jam*`;
    } else {
      finalReply = formatResponse(reply);
    }
    const chunks = splitMessage(finalReply);
    if (chunks.length === 1) await message.reply(chunks[0]);
    else for (const chunk of chunks) await message.channel.send(chunk);
  } catch (e) {
    console.error('❌ Error Ollama API:', e.message);
    message.reply('❌ Terjadi error. Coba lagi ya!');
  } finally { stopTyping(); }
});

// ============================
//   EVENT: SLASH COMMANDS
// ============================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const isCreator = userId === CREATOR_ID;
  const nickname = nicknames.get(userId) || null;

  // Helper biar tidak timeout
  await interaction.deferReply();

  try {
    // /help
    if (commandName === 'help') {
      return interaction.editReply(
        `📖 **Cara Pakai ${BOT_NAME}**\n\n` +
        `💬 \`/ai\` — Tanya AI\n🔍 \`/cari\` — Cari di internet\n🎨 \`/image\` — Generate gambar\n` +
        `🌐 \`/terjemah\` — Translate teks\n☀️ \`/cuaca\` — Info cuaca\n🧮 \`/hitung\` — Kalkulator\n` +
        `💡 \`/quote\` — Kutipan motivasi\n📝 \`/ringkas\` — Ringkas teks\n🔥 \`/roast\` — Roast user\n` +
        `💘 \`/ship\` — Cek kecocokan\n🖼️ \`/pp\` — Foto profil\n♈ \`/horoscope\` — Ramalan bintang\n` +
        `🎯 \`/truth\` — Pertanyaan truth\n🔥 \`/dare\` — Challenge dare\n📖 \`/cerita\` — Bikin cerita pendek\n💙 \`/curhat\` — Curhat ke AI\n` +
        `🧠 \`/kuis\` — Trivia\n🕌 \`/jadwal\` — Jadwal sholat\n🏓 \`/ping\` — Cek latency\n🔄 \`/reset\` — Reset history\n\n` +
        `> 🤖 Dibuat oleh **${CREATOR}**`
      );
    }

    // /ping
    if (commandName === 'ping') {
      return interaction.editReply(`🏓 **Pong!**\n💓 WebSocket: **${interaction.client.ws.ping}ms**`);
    }

    // /reset
    if (commandName === 'reset') {
      conversations.delete(userId);
      return interaction.editReply('✅ History percakapan kamu sudah direset!');
    }

    // /quote
    if (commandName === 'quote') {
      let q, source = '🌐';
      try {
        q = await fetchOnlineQuote();
        q.text = await translateText(q.text, 'Indonesia');
      } catch {
        q = quotesOffline[Math.floor(Math.random() * quotesOffline.length)];
        source = '📦';
      }
      return interaction.editReply(`💡 **Quote of the moment** ${source}\n\n*"${q.text}"*\n— **${q.author}**`);
    }

    // /truth
    if (commandName === 'truth') {
      const pertanyaan = await generateTruth();
      return interaction.editReply(`🎯 **Truth untuk ${username}**\n\n*"${pertanyaan}"*\n\n> Harus jujur ya! 😏`);
    }

    // /dare
    if (commandName === 'dare') {
      try {
        const challenge = await generateDare();
        return interaction.editReply(`🔥 **Dare untuk ${username}**\n\n*"${challenge}"*\n\n> Jangan takut ya! 😈`);
      } catch (e) {
        console.error('❌ Error /dare:', e.message, e.stack);
        return interaction.editReply(`❌ Gagal generate challenge. Error: ${e.message}`);
      }
    }

    // /tarot
    if (commandName === 'tarot') {
      const { past, present, future, reading } = await generateTarot(username);
      const buffer = await generateTarotImage(past, present, future, username);
      const tarotMsg =
        `🔮 **Ramalan Tarot untuk ${username}**\n\n` +
        `> ${past.emoji} **${past.name}**\n> *${past.meaning}*\n\n` +
        `> ${present.emoji} **${present.name}**\n> *${present.meaning}*\n\n` +
        `> ${future.emoji} **${future.name}**\n> *${future.meaning}*\n\n` +
        `✨ **Ramalan:**\n${reading}`;
      if (buffer) {
        const attachment = new AttachmentBuilder(buffer, { name: 'tarot.png' });
        return interaction.editReply({ content: tarotMsg, files: [attachment] });
      }
      return interaction.editReply(tarotMsg);
    }

    // /kuis
    if (commandName === 'kuis') {
      if (kuisGames.has(userId)) {
        const ex = kuisGames.get(userId);
        return interaction.editReply(`❓ Masih ada soal aktif!\n\n**${ex.soal}**\n\nJawab dengan \`!jawab <jawaban>\``);
      }
      const kuis = await generateKuis();
      kuisGames.set(userId, kuis);
      return interaction.editReply(`🧠 **Trivia Time!**\n\n❓ **${kuis.soal}**\n\nJawab dengan \`!jawab <jawabanmu>\``);
    }

    // /pp
    if (commandName === 'pp') {
      const target = interaction.options.getUser('user') || interaction.user;
      const avatarURL = target.displayAvatarURL({ size: 512, extension: 'png', forceStatic: false });
      const { EmbedBuilder } = require('discord.js');
      const embed = new EmbedBuilder()
        .setTitle(`🖼️ Foto profil ${target.username}`)
        .setImage(avatarURL)
        .setColor(0x5865F2);
      return interaction.editReply({ embeds: [embed] });
    }

    // /hitung
    if (commandName === 'hitung') {
      const expr = interaction.options.getString('ekspresi');
      if (!/^[0-9+\-*/.() %^]+$/.test(expr)) return interaction.editReply('❌ Ekspresi tidak valid!');
      const result = Function('"use strict"; return (' + expr + ')')();
      if (!isFinite(result)) return interaction.editReply('❌ Hasil tidak valid!');
      return interaction.editReply(`🧮 **Kalkulator**\n\n📥 Input: \`${expr}\`\n📤 Hasil: \`${result}\``);
    }

    // /ship dengan gambar
    if (commandName === 'ship') {
      const u1 = interaction.options.getUser('user1');
      const u2 = interaction.options.getUser('user2');
      const seed = (u1.id + u2.id).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      const pct = seed % 101;
      const emoji = pct >= 80 ? '💘' : pct >= 50 ? '💛' : pct >= 30 ? '🤝' : '💔';
      try {
        const komen = await generateShipKomen(u1.username, u2.username, pct);
        const loveEmoji = pct >= 80 ? '💖' : pct >= 60 ? '💗' : pct >= 40 ? '💛' : pct >= 20 ? '💙' : '💔';
        const header = `${loveEmoji} **<@${u1.id}> + <@${u2.id}> = ${pct}% of Love** ${loveEmoji}`;
        const av1 = u1.displayAvatarURL({ size: 256, extension: 'png', forceStatic: true });
        const av2 = u2.displayAvatarURL({ size: 256, extension: 'png', forceStatic: true });
        const buffer = await generateShipImage(av1, av2, pct, u1.username, u2.username);
        if (buffer) {
          const attachment = new AttachmentBuilder(buffer, { name: 'ship.png' });
          return interaction.editReply({ content: `${header}\n${komen}`, files: [attachment] });
        }
        return interaction.editReply(`${header}\n${komen}`);
      } catch (e) { console.warn('Ship failed:', e.message); }
    }

    // /roast
    if (commandName === 'roast') {
      const target = interaction.options.getUser('user');
      if (target.id === CREATOR_ID) {
        const res = await ollama.chat({
          model: OLLAMA_MODEL,
          messages: [
            { role: 'system', content: 'Kamu adalah sahabat dekat Jamal, seorang developer muda keren. Buat 4-5 kalimat pujian yang personal, natural, dan tulus. Sebut namanya Jamal. Bahasa gaul Indonesia.' },
            { role: 'user', content: 'Puji Jamal!' },
          ],
          stream: false,
        });
        return interaction.editReply(`✨ **Spesial untuk <@${target.id}>**\n\n${res.message.content}`);
      }
      return interaction.editReply(`🔥 **Roast untuk <@${target.id}>**\n\n${roastUser(target.username)}`);
    }

    // /horoscope
    if (commandName === 'horoscope') {
      const zodiak = interaction.options.getString('zodiak');
      const emojiMap = { aries:'♈',taurus:'♉',gemini:'♊',cancer:'♋',leo:'♌',virgo:'♍',libra:'♎',scorpio:'♏',sagittarius:'♐',capricorn:'♑',aquarius:'♒',pisces:'♓' };
      const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
      const tgl = `${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()}`;
      const res = await ollama.chat({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: 'Kamu adalah astrolog Discord yang seru. Buat ramalan harian yang menarik. Format: 3-4 kalimat ramalan, lalu "Keberuntungan: ⭐⭐⭐", "Warna hari ini: [warna]", "Angka keberuntungan: [angka]". Bahasa gaul Indonesia.' },
          { role: 'user', content: `Ramalan ${zodiak} tanggal ${tgl}` },
        ],
        stream: false,
      });
      return interaction.editReply(`${emojiMap[zodiak]} **${zodiak.charAt(0).toUpperCase()+zodiak.slice(1)} — ${tgl}**\n\n${res.message.content}`);
    }

    // /cuaca
    if (commandName === 'cuaca') {
      const kotaInput = interaction.options.getString('kota');
      const kota = translateCityName(kotaInput);
      
      try {
        const weather = await fetchWeather(kota);
        
        if (!weather.success) {
          return interaction.editReply(
            `❌ Kota **${kotaInput}** tidak ditemukan.\n\n` +
            `💡 Coba dengan nama kota yang lebih lengkap atau dalam Bahasa Inggris.\n` +
            `📝 Contoh: Jakarta, Semarang, Yogyakarta`
          );
        }

        const emoji = getWeatherEmoji(weather.condition);
        return interaction.editReply(
          `${emoji} **Cuaca di ${weather.city}, ${weather.country}**\n\n` +
          `🌡️ Suhu: **${weather.temp}°C** (terasa ${weather.feels}°C)\n` +
          `🌤️ Kondisi: **${weather.description || weather.condition}**\n` +
          `💧 Kelembaban: **${weather.humidity}%**\n` +
          `💨 Angin: **${weather.windSpeed} km/h**\n\n` +
          `> 📡 *Data dari OpenWeatherMap*`
        );
      } catch (e) {
        console.error('❌ Error cuaca slash:', e.message);
        return interaction.editReply('❌ Gagal mengambil data cuaca. Coba lagi!');
      }
    }

    // /terjemah
    if (commandName === 'terjemah') {
      const bahasa = interaction.options.getString('bahasa');
      const teks = interaction.options.getString('teks');
      const result = await translateText(teks, bahasa);
      return interaction.editReply(`🌐 **Terjemahan ke ${bahasa}**\n\n📥 Asli: *${teks}*\n📤 Hasil: **${result}**`);
    }

    // /ringkas
    if (commandName === 'ringkas') {
      const teks = interaction.options.getString('teks');
      if (teks.length < 50) return interaction.editReply('❌ Teksnya terlalu pendek!');
      const result = await ringkasText(teks);
      return interaction.editReply(`📝 **Ringkasan**\n\n${result}`);
    }

    // /cerita
    if (commandName === 'cerita') {
      const tema = interaction.options.getString('tema');
      const cerita = await generateCerita(tema);
      return interaction.editReply(`📖 **Cerita: ${tema}**\n\n${cerita}`);
    }

    // /curhat
    if (commandName === 'curhat') {
      const isi = interaction.options.getString('isi');
      const respons = await generateCurhat(isi);
      return interaction.editReply(`💙 **NEO AI mendengarkanmu...**\n\n${respons}`);
    }

    // /jadwal
    if (commandName === 'jadwal') {
      const kotaInput = interaction.options.getString('kota');
      const kota = kotaInput || userLocations.get(userId);
      if (!kota) return interaction.editReply('❌ Tulis kotamu! Contoh: `/jadwal kota:Jakarta`');
      const timings = await getJadwalSholat(kota);
      const msg = formatJadwal(kota, timings);
      const sent = await interaction.editReply(msg);
      setTimeout(async () => { try { await interaction.deleteReply(); } catch {} }, 60 * 1000);
      return;
    }

    // /cari
    if (commandName === 'cari') {
      const query = interaction.options.getString('query');
      const { results, engine } = await searchWeb(query);
      const ringkasan = await rangkumHasilCari(query, results);
      const sumber = [...new Set(results.map(r => r.source))].slice(0, 3);
      return interaction.editReply(
        `🔍 **Hasil Pencarian** ${engine}\n📝 Query: *${query}*\n\n📋 **Ringkasan:**\n${ringkasan}\n\n🌐 **Sumber:**\n${sumber.map(s => `• ${s}`).join('\n')}`
      );
    }

    // /image
    if (commandName === 'image') {
      const prompt = interaction.options.getString('deskripsi');
      const encodedPrompt = encodeURIComponent(prompt);
      const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true`;
      try {
        const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        const attachment = new AttachmentBuilder(buffer, { name: 'generated.png' });
        return interaction.editReply({ content: `🎨 **Generate Image**\n\n**Prompt:** ${prompt}`, files: [attachment] });
      } catch {
        return interaction.editReply(`🎨 **Generate Image**\n\n**Prompt:** ${prompt}\n${imageUrl}`);
      }
    }

    // /ai
    if (commandName === 'ai') {
      const userText = interaction.options.getString('pertanyaan');
      const detectedNick = detectNickname(userText);
      if (detectedNick) { nicknames.set(userId, detectedNick); saveNicknames(); }
      if (!conversations.has(userId)) conversations.set(userId, []);
      const history = conversations.get(userId);
      history.push({ role: 'user', content: `[Pesan dari user Discord: ${username}] ${userText}` });
      const reply = await askAI(history, { nickname: nicknames.get(userId) || null, isCreator });
      history.push({ role: 'assistant', content: reply });
      if (history.length > MAX_HISTORY) history.splice(0, 2);
      const htmlContent = extractHTML(reply);
      if (htmlContent) {
        const previewId = generatePreviewId();
        previews.set(previewId, { html: htmlContent, createdAt: Date.now() });
        return interaction.editReply(`${formatResponse(reply)}\n\n🌐 **Preview:** ${PREVIEW_DOMAIN}/preview/${previewId}\n> ⏳ *Link expired dalam 1 jam*`);
      }
      return interaction.editReply(formatResponse(reply));
    }

  } catch (e) {
    console.error(`❌ Error slash /${commandName}:`, e.message);
    try { await interaction.editReply('❌ Terjadi error. Coba lagi ya!'); } catch {}
  }
});

// ============================
//   LOGIN BOT
// ============================
client.login(process.env.DISCORD_TOKEN);
