"use strict";

/* =========================================================
   櫻ポーカー サーバー
   - 静的ファイル配信(sakura_poker_fixed.html / hand_editor.html / hand-engine.js)
   - アカウントAPI(登録・ログイン・オリジナル役の保存)
   - オンライン対戦用 WebSocketサーバー(2〜4人ルーム制)
     ベッティング/フェーズ進行ロジックは hand-engine.js の createTable() を共有利用しています。

   起動方法:
     npm install
     npm start
   その後ブラウザで http://localhost:8787/ を開いてください。
   (file://で直接HTMLを開くとAPI/WebSocketに接続できません)
========================================================= */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const crypto = require("crypto");
const WebSocket = require("ws");
const SakuraHandEngine = require("./hand-engine.js");

const PORT = process.env.PORT || 8787;
const DB_PATH = path.join(__dirname, "db.json");
const STARTING_POINTS = 1000;
const CPU_STARTING_CHIPS = 500;
const MAX_POINTS_PER_EARN = 2000; // 1回の対戦で持ち点に反映できる上限(不正な大量加算を防ぐための簡易な上限)
const TURN_TIMEOUT_MS = 25000; // オンライン対戦で無操作が続いた場合に自動フォールドするまでの時間

const STARTING_RANK_POINTS = 0;
const RANK_WIN_DELTA = 30;
const RANK_LOSE_DELTA = -10;
const RANK_TIERS = [
  { name: "ブロンズ", min: 0 },
  { name: "シルバー", min: 1000 },
  { name: "ゴールド", min: 1500 },
  { name: "プラチナ", min: 2000 },
  { name: "ダイヤモンド", min: 3000 }
];

function getRankTier(rankPoints) {
  let tier = RANK_TIERS[0].name;
  for (const t of RANK_TIERS) {
    if (rankPoints >= t.min) tier = t.name;
  }
  return tier;
}

/* =========================================================
   アカウントDB(JSONファイル / パスワードはPBKDF2でハッシュ化)
========================================================= */
let db = { users: {} };

function loadDb() {
  try {
    db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    if (!db.users) db.users = {};
  } catch (e) {
    db = { users: {} };
  }
}

function saveDb() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

loadDb();

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
}

function createUser(username, password) {
  const salt = crypto.randomBytes(16).toString("hex");
  db.users[username] = {
    salt,
    hash: hashPassword(password, salt),
    hands: [],
    favoriteMember: null,
    points: STARTING_POINTS,
    rankPoints: STARTING_RANK_POINTS,
    stats: { cpuGamesPlayed: 0, cpuWins: 0, onlineWins: 0, onlineLosses: 0 }
  };
  saveDb();
}

function verifyUser(username, password) {
  const u = db.users[username];
  if (!u) return false;
  return hashPassword(password, u.salt) === u.hash;
}

function isValidUsername(u) {
  return typeof u === "string" && /^[A-Za-z0-9_ぁ-んァ-ヶ一-龠ー]{2,16}$/.test(u);
}

function isValidPassword(p) {
  return typeof p === "string" && p.length >= 4 && p.length <= 64;
}

const tokens = new Map(); // token -> username

function makeToken(username) {
  const t = crypto.randomBytes(24).toString("hex");
  tokens.set(t, username);
  return t;
}

function getUserHands(username) {
  return (db.users[username] && db.users[username].hands) || [];
}

function getFavoriteMember(username) {
  return (db.users[username] && db.users[username].favoriteMember) || null;
}

/* 既存アカウント(points/stats/rankPoints追加前に作成されたもの)に対する後方互換の初期値補完 */
function ensureUserDefaults(username) {
  const u = db.users[username];
  if (!u) return;
  let changed = false;
  if (typeof u.points !== "number") { u.points = STARTING_POINTS; changed = true; }
  if (typeof u.rankPoints !== "number") { u.rankPoints = STARTING_RANK_POINTS; changed = true; }
  if (!u.stats) { u.stats = {}; changed = true; }
  if (typeof u.stats.cpuGamesPlayed !== "number") { u.stats.cpuGamesPlayed = 0; changed = true; }
  if (typeof u.stats.cpuWins !== "number") { u.stats.cpuWins = 0; changed = true; }
  if (typeof u.stats.onlineWins !== "number") { u.stats.onlineWins = 0; changed = true; }
  if (typeof u.stats.onlineLosses !== "number") { u.stats.onlineLosses = 0; changed = true; }
  if (changed) saveDb();
}

function getUserPoints(username) {
  ensureUserDefaults(username);
  return db.users[username].points;
}

function getUserStats(username) {
  ensureUserDefaults(username);
  return db.users[username].stats;
}

function getUserRankPoints(username) {
  ensureUserDefaults(username);
  return db.users[username].rankPoints;
}

/* =========================================================
   HTTP API
========================================================= */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function buildProfilePayload(username) {
  const rankPoints = getUserRankPoints(username);
  return {
    username,
    hands: getUserHands(username),
    favoriteMember: getFavoriteMember(username),
    points: getUserPoints(username),
    stats: getUserStats(username),
    rankPoints,
    rankTier: getRankTier(rankPoints)
  };
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function handleApi(req, res, pathname, query) {
  try {
    if (pathname === "/api/register" && req.method === "POST") {
      const body = await readJsonBody(req);
      const { username, password } = body;
      if (!isValidUsername(username)) {
        return sendJson(res, 400, { error: "ユーザー名は2〜16文字(英数字・ひらがな・カタカナ・漢字)で入力してください。" });
      }
      if (!isValidPassword(password)) {
        return sendJson(res, 400, { error: "パスワードは4文字以上で入力してください。" });
      }
      if (db.users[username]) {
        return sendJson(res, 409, { error: "そのユーザー名は既に使われています。" });
      }
      createUser(username, password);
      const token = makeToken(username);
      return sendJson(res, 200, { token, ...buildProfilePayload(username) });
    }

    if (pathname === "/api/login" && req.method === "POST") {
      const body = await readJsonBody(req);
      const { username, password } = body;
      if (!verifyUser(username, password)) {
        return sendJson(res, 401, { error: "ユーザー名またはパスワードが正しくありません。" });
      }
      const token = makeToken(username);
      return sendJson(res, 200, { token, ...buildProfilePayload(username) });
    }

    if (pathname === "/api/logout" && req.method === "POST") {
      const body = await readJsonBody(req);
      tokens.delete(body.token);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === "/api/profile" && req.method === "GET") {
      const username = tokens.get(query.token);
      if (!username) return sendJson(res, 401, { error: "認証エラーです。再度ログインしてください。" });
      return sendJson(res, 200, buildProfilePayload(username));
    }

    if (pathname === "/api/profile" && req.method === "POST") {
      const body = await readJsonBody(req);
      const username = tokens.get(body.token);
      if (!username) return sendJson(res, 401, { error: "認証エラーです。再度ログインしてください。" });

      const favoriteMember = body.favoriteMember;
      if (favoriteMember !== null && !SakuraHandEngine.MEMBERS.some(m => m.name === favoriteMember)) {
        return sendJson(res, 400, { error: "推しメンが正しく指定されていません。" });
      }

      db.users[username].favoriteMember = favoriteMember;
      saveDb();
      return sendJson(res, 200, buildProfilePayload(username));
    }

    if (pathname === "/api/points/earn" && req.method === "POST") {
      const body = await readJsonBody(req);
      const username = tokens.get(body.token);
      if (!username) return sendJson(res, 401, { error: "認証エラーです。再度ログインしてください。" });

      // CPU対戦は持ち点を賭けず500点からスタートし、増加した分だけ持ち点に加算する。
      // クライアント側で算出した値をそのまま信用すると改ざんの恐れがあるため、上限でクランプする。
      const gained = Math.max(0, Math.min(MAX_POINTS_PER_EARN, Math.floor(Number(body.gained) || 0)));

      ensureUserDefaults(username);
      db.users[username].points += gained;
      db.users[username].stats.cpuGamesPlayed += 1;
      if (body.won) db.users[username].stats.cpuWins += 1;
      saveDb();

      return sendJson(res, 200, { points: getUserPoints(username), stats: getUserStats(username) });
    }

    if (pathname === "/api/hands" && req.method === "GET") {
      const username = tokens.get(query.token);
      if (!username) return sendJson(res, 401, { error: "認証エラーです。再度ログインしてください。" });
      return sendJson(res, 200, { hands: getUserHands(username) });
    }

    if (pathname === "/api/hands" && req.method === "POST") {
      const body = await readJsonBody(req);
      const username = tokens.get(body.token);
      if (!username) return sendJson(res, 401, { error: "認証エラーです。再度ログインしてください。" });

      const names = body.names;
      const poolType = body.poolType === "all" ? "all" : "active";

      if (!SakuraHandEngine.isValidCustomNamesForPool(names, poolType)) {
        return sendJson(res, 400, {
          error: poolType === "active"
            ? "カードは2〜5枚、重複なしで実在する在籍メンバーの名前を指定してください(卒業済みメンバーは「全メンバー版」で指定してください)。"
            : "カードは2〜5枚、重複なしで実在するメンバー名を指定してください。"
        });
      }

      const label = (body.label || "").toString().trim().slice(0, 30) || `オリジナル役(${names.join("・")})`;
      const hand = {
        id: `custom_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
        label,
        names,
        poolType
      };

      // 1アカウントにつき、枚数(2/3/4/5枚)×プール種別(在籍のみ/全メンバー)ごとに
      // 登録できるオリジナル役は1つまで(同じ枚数・同じプール種別で再登録すると上書き)。
      db.users[username].hands = getUserHands(username)
        .filter(h => !(h.names.length === names.length && (h.poolType || "active") === poolType));
      db.users[username].hands.push(hand);
      saveDb();
      return sendJson(res, 200, { hands: getUserHands(username) });
    }

    if (pathname === "/api/hands" && req.method === "DELETE") {
      const body = await readJsonBody(req);
      const username = tokens.get(body.token);
      if (!username) return sendJson(res, 401, { error: "認証エラーです。再度ログインしてください。" });

      db.users[username].hands = getUserHands(username).filter(h => h.id !== body.id);
      saveDb();
      return sendJson(res, 200, { hands: getUserHands(username) });
    }

    return sendJson(res, 404, { error: "not found" });
  } catch (e) {
    console.log("APIエラー:", e);
    return sendJson(res, 500, { error: "サーバーエラーが発生しました。" });
  }
}

/* =========================================================
   静的ファイル配信
========================================================= */
const STATIC_FILES = {
  "/": "sakura_poker_fixed.html",
  "/sakura_poker_fixed.html": "sakura_poker_fixed.html",
  "/hand_editor.html": "hand_editor.html",
  "/hand-engine.js": "hand-engine.js",
  "/members-data.js": "members-data.js"
};

function serveStatic(res, fileName) {
  const filePath = path.join(__dirname, fileName);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ファイルが見つかりません。");
      return;
    }
    const ext = path.extname(filePath);
    const type = ext === ".js" ? "application/javascript; charset=utf-8" : "text/html; charset=utf-8";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  if (parsed.pathname.startsWith("/api/")) {
    handleApi(req, res, parsed.pathname, parsed.query);
    return;
  }

  if (STATIC_FILES[parsed.pathname]) {
    serveStatic(res, STATIC_FILES[parsed.pathname]);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

/* =========================================================
   オンライン対戦ルーム管理
   (ベッティング進行そのものは hand-engine.js の createTable に委譲)
========================================================= */
const rooms = new Map(); // roomId -> room

function genRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id;
  do {
    id = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(id));
  return id;
}

function sendRoomState(room) {
  const payload = {
    type: "roomState",
    roomId: room.id,
    hostUsername: room.hostUsername,
    deckPoolName: room.deckPoolName,
    players: room.usernames.map((u, i) => ({
      username: u,
      connected: !!room.sockets[i],
      rankTier: getRankTier(getUserRankPoints(u))
    })),
    canStart: room.usernames.length >= 2 && room.usernames.length <= 4
  };
  room.sockets.forEach(sock => {
    if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(payload));
  });
}

function reindexRoom(room) {
  room.sockets.forEach((sock, i) => {
    if (sock) sock.seat = i;
  });
  room.hostUsername = room.usernames[0] || null;
}

function safeEvaluateForViewer(room, viewerSeat) {
  const table = room.table;
  const p = table.players[viewerSeat];
  if (!p || p.holeCards.length + table.communityCards.length < 5) return null;
  return SakuraHandEngine.evaluateBestHand([...p.holeCards, ...table.communityCards], table.HAND_DEFS, table.HAND_NAMES);
}

function buildStateFor(room, viewerSeat) {
  const table = room.table;
  const revealAll = table.handPhase === "result" || table.handPhase === "gameover";

  const players = table.players.map((p, i) => {
    const showCards = i === viewerSeat ? p.holeCards : (revealAll && !p.folded && !p.sittingOut ? p.holeCards : []);
    return {
      seat: i,
      username: p.name,
      chips: p.chips,
      betThisRound: p.betThisRound,
      folded: p.folded,
      sittingOut: p.sittingOut,
      allIn: p.allIn,
      connected: !!room.sockets[i],
      isYou: i === viewerSeat,
      isTurn: table.turnSeat === i,
      isDealer: table.dealerIndex === i,
      cardCount: p.sittingOut ? 0 : p.holeCards.length,
      cards: showCards
    };
  });

  const evalResult = safeEvaluateForViewer(room, viewerSeat);
  const PHASES = ["プリフロップ", "フロップ", "ターン", "リバー"];

  return {
    type: "gameState",
    roomId: room.id,
    hostUsername: room.hostUsername,
    started: room.started,
    gameOver: !!table.gameOver,
    deckPoolName: room.deckPoolName,
    handPhase: table.handPhase,
    phaseLabel:
      table.handPhase === "betting" ? PHASES[table.phaseIndex] :
      table.handPhase === "result" ? "ショーダウン" :
      table.handPhase === "gameover" ? "終了" : "待機中",
    communityCards: table.communityCards,
    pot: table.pot,
    currentBetLevel: table.currentBetLevel,
    players,
    turnSeat: table.turnSeat,
    isYourTurn: table.turnSeat === viewerSeat,
    yourSeat: viewerSeat,
    handNames: table.HAND_NAMES || [],
    handDefs: table.HAND_DEFS || [],
    yourHandName: evalResult ? evalResult.name : null,
    yourHandRank: evalResult ? evalResult.rank : null,
    lastResult: table.lastResult || null,
    message: table.message || ""
  };
}

function broadcastState(room) {
  room.sockets.forEach((sock, i) => {
    if (sock && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify(buildStateFor(room, i)));
    }
  });
}

/*
  オンライン対戦のターンタイマー。一定時間操作がない場合は自動フォールドさせる
  (放置によって他の参加者の対戦が止まってしまうのを防ぐための、モバイル対戦アプリでは
  一般的な機能)。state変化のたびに呼び出し、現在の手番に対してのみタイマーを張り直す。
*/
function scheduleTurnTimeout(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }

  const table = room.table;
  if (!table || table.handPhase !== "betting" || table.turnSeat == null) return;

  const seat = table.turnSeat;
  room.turnTimer = setTimeout(() => {
    if (room.disposed) return;
    if (table.turnSeat === seat && table.handPhase === "betting") {
      table.action(seat, "fold", 0);
    }
  }, TURN_TIMEOUT_MS);
}

function createRoom(ws, deckPoolName) {
  const roomId = genRoomId();
  const room = {
    id: roomId,
    usernames: [ws.username],
    sockets: [ws],
    hostUsername: ws.username,
    started: false,
    table: null,
    disposed: false,
    rankSettled: false,
    deckPoolName: deckPoolName === "all" ? "all" : "active"
  };

  rooms.set(roomId, room);
  ws.roomId = roomId;
  ws.seat = 0;
  sendRoomState(room);
}

function joinRoom(ws, roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    ws.send(JSON.stringify({ type: "error", message: "そのルームIDは見つかりません。" }));
    return;
  }

  const existingIdx = room.usernames.indexOf(ws.username);
  if (existingIdx >= 0) {
    room.sockets[existingIdx] = ws;
    ws.roomId = roomId;
    ws.seat = existingIdx;
    if (room.started) broadcastState(room);
    else sendRoomState(room);
    return;
  }

  if (room.started) {
    ws.send(JSON.stringify({ type: "error", message: "そのルームは既に対戦が始まっています。" }));
    return;
  }
  if (room.usernames.length >= 4) {
    ws.send(JSON.stringify({ type: "error", message: "そのルームは満員です(最大4人)。" }));
    return;
  }

  room.usernames.push(ws.username);
  room.sockets.push(ws);
  ws.roomId = roomId;
  ws.seat = room.usernames.length - 1;
  sendRoomState(room);
}

function leaveRoom(ws) {
  const room = rooms.get(ws.roomId);
  if (!room || room.started) return;

  const idx = room.usernames.indexOf(ws.username);
  if (idx >= 0) {
    room.usernames.splice(idx, 1);
    room.sockets.splice(idx, 1);
  }

  ws.roomId = null;
  ws.seat = null;

  if (room.usernames.length === 0) {
    rooms.delete(room.id);
    return;
  }

  reindexRoom(room);
  sendRoomState(room);
}

function startGameForWs(ws) {
  const room = rooms.get(ws.roomId);
  if (!room) return;
  if (room.hostUsername !== ws.username) {
    ws.send(JSON.stringify({ type: "error", message: "ホストのみ対戦を開始できます。" }));
    return;
  }
  if (room.usernames.length < 2 || room.usernames.length > 4) {
    ws.send(JSON.stringify({ type: "error", message: "2〜4人で対戦を開始してください。" }));
    return;
  }
  if (room.started) return;

  // 在籍のみデッキでは「在籍のみ版」のオリジナル役だけを使用。
  // 全メンバーデッキでは「在籍のみ版」「全メンバー版」の両方を使用できる。
  const customHandsPool = room.usernames
    .flatMap(u => getUserHands(u))
    .filter(h => room.deckPoolName === "all" || (h.poolType || "active") === "active");
  const deckPool = SakuraHandEngine.DECKS[room.deckPoolName] || SakuraHandEngine.ACTIVE_MEMBERS;

  room.table = SakuraHandEngine.createTable({
    playerNames: room.usernames.slice(),
    customHandsPool,
    deckPool,
    onChange: () => {
      broadcastState(room);
      scheduleTurnTimeout(room);
      settleRankIfGameOver(room);
    },
    isBot: () => false,
    isConnected: seat => !!room.sockets[seat],
    isDisposed: () => room.disposed,
    autoAdvanceMs: 3500
  });

  room.started = true;
  room.table.startGame();
}

/*
  ランクポイント(持ち点とは別の、対戦の強さを表す指標)はオンライン対戦のみで変動します。
  サーバーが計算する最終結果(チップが残った1人が勝者)に基づくため、CPU対戦の持ち点と異なり
  クライアントから値を送らせない=改ざんの余地がありません。
*/
function settleRankIfGameOver(room) {
  const table = room.table;
  if (!table || !table.gameOver || room.rankSettled) return;
  room.rankSettled = true;

  const winnerIdx = table.players.findIndex(p => !p.sittingOut);

  room.usernames.forEach((username, i) => {
    ensureUserDefaults(username);
    const isWinner = i === winnerIdx;
    const delta = isWinner ? RANK_WIN_DELTA : RANK_LOSE_DELTA;
    db.users[username].rankPoints = Math.max(0, db.users[username].rankPoints + delta);
    if (isWinner) db.users[username].stats.onlineWins += 1;
    else db.users[username].stats.onlineLosses += 1;
  });

  saveDb();
}

function handleDisconnect(ws) {
  if (!ws.roomId) return;
  const room = rooms.get(ws.roomId);
  if (!room) return;

  if (room.sockets[ws.seat] === ws) room.sockets[ws.seat] = null;

  if (!room.started) {
    const idx = room.usernames.indexOf(ws.username);
    if (idx >= 0) {
      room.usernames.splice(idx, 1);
      room.sockets.splice(idx, 1);
    }
    if (room.usernames.length === 0) {
      rooms.delete(room.id);
      return;
    }
    reindexRoom(room);
    sendRoomState(room);
    return;
  }

  if (room.table && room.table.turnSeat === ws.seat && room.table.handPhase === "betting") {
    room.table.action(ws.seat, "fold", 0);
  } else {
    broadcastState(room);
  }

  if (room.sockets.every(s => !s)) {
    room.disposed = true;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    rooms.delete(room.id);
  }
}

/* =========================================================
   WebSocket
========================================================= */
const wss = new WebSocket.Server({ server });

wss.on("connection", ws => {
  ws.roomId = null;
  ws.seat = null;
  ws.username = null;

  ws.on("message", raw => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }

    if (msg.type === "auth") {
      const username = tokens.get(msg.token);
      if (!username) {
        ws.send(JSON.stringify({ type: "error", message: "認証に失敗しました。再度ログインしてください。" }));
        return;
      }
      ws.username = username;
      ws.send(JSON.stringify({ type: "authOk", username }));
      return;
    }

    if (!ws.username) {
      ws.send(JSON.stringify({ type: "error", message: "先に認証してください。" }));
      return;
    }

    if (msg.type === "listRooms") {
      const list = [...rooms.values()]
        .filter(r => !r.started)
        .map(r => ({ roomId: r.id, players: r.usernames.length, hostUsername: r.hostUsername }));
      ws.send(JSON.stringify({ type: "roomList", rooms: list }));
      return;
    }

    if (msg.type === "createRoom") {
      createRoom(ws, msg.deckPool);
      return;
    }

    if (msg.type === "joinRoom") {
      joinRoom(ws, String(msg.roomId || "").toUpperCase());
      return;
    }

    if (msg.type === "leaveRoom") {
      leaveRoom(ws);
      return;
    }

    if (msg.type === "startGame") {
      startGameForWs(ws);
      return;
    }

    if (msg.type === "action") {
      if (ws.roomId == null || ws.seat == null) return;
      const room = rooms.get(ws.roomId);
      if (!room || !room.table) return;
      if (room.sockets[ws.seat] !== ws) return;
      room.table.action(ws.seat, msg.action, msg.amount);
      return;
    }
  });

  ws.on("close", () => {
    handleDisconnect(ws);
  });
});

server.listen(PORT, () => {
  console.log(`櫻ポーカーサーバーを起動しました： http://localhost:${PORT}/`);
});
