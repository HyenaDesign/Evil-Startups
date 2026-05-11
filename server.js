const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const rooms = new Map();

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const themes = [
  { title: "Child-Surveillance Smoothie Subscription Cult", tags: ["smoothies", "school dashboards", "cheerful dread"] },
  { title: "Subscription Oxygen For Luxury Apartment Elevators", tags: ["breathing", "premium tiers", "landlord synergy"] },
  { title: "AI Politician That Only Speaks In App Notifications", tags: ["democracy", "push alerts", "engagement"] },
  { title: "Wellness App That Turns Sleep Into A Competitive Sport", tags: ["sleep", "leaderboards", "shame streaks"] },
  { title: "Data-Harvesting Amusement Park For Bored Billionaires", tags: ["roller coasters", "face scans", "VIP panic"] },
  { title: "Bureaucracy-As-A-Service For Haunted City Halls", tags: ["forms", "ghost permits", "enterprise"] },
];

const rounds = [
  {
    type: "text",
    title: "Name Rush",
    prompt: "Name this cursed company.",
    seconds: 36,
    placeholder: "Ex: GuiltShake Plus",
    fallback: ["KidKapture", "OxyLux", "CivicPing", "NapRank", "ConsentLand"],
  },
  {
    type: "combo",
    title: "Buzzword Blender",
    prompt: "Combine three buzzwords into the product.",
    seconds: 32,
    columns: [
      ["AI-powered", "family-safe", "premium", "emotion-native"],
      ["oxygen", "homework", "sleep", "regret"],
      ["flywheel", "subscription", "dashboard", "cult"],
    ],
  },
  {
    type: "text",
    title: "PR Disaster Sprint",
    prompt: "Respond to the scandal in one sentence.",
    seconds: 38,
    placeholder: "Ex: We regret that users experienced involuntary loyalty.",
    fallback: [
      "We apologize for accidentally creating a small economy of fear.",
      "Our mascot's opinions do not represent the board, usually.",
      "We remain committed to transparency after deleting the dashboard.",
    ],
  },
  {
    type: "draw",
    title: "Logo Drawing",
    prompt: "Draw your company's logo.",
    seconds: 45,
    placeholder: "",
    fallback: [
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    ],
  },
  {
    type: "text",
    title: "One Word Feeling",
    prompt: "Describe your company's vibe in one word.",
    seconds: 25,
    placeholder: "Ex: Chaotic",
    fallback: [
      "Chaotic",
      "Doomed",
      "Profitable",
      "Illegal",
      "Unstable",
    ],
  },
  {
    type: "text",
    title: "Exit Strategy",
    prompt: "How will you exit this disaster?",
    seconds: 40,
    placeholder: "Ex: Sell to a bigger disaster",
    fallback: [
      "IPO at the bottom of the market",
      "Acquire a competitor's lawsuits",
      "Go public with private regrets",
    ],
  },
];

const events = [
  { title: "The EU launched an investigation.", body: "The host says this is basically free marketing with accents." },
  { title: "Your mascot became self-aware.", body: "It demanded equity, snacks, and a larger role in push notifications." },
  { title: "A celebrity accidentally endorsed the product.", body: "They meant to promote a protein powder but the stock still tripled." },
  { title: "Your CEO was arrested on a hoverboard.", body: "Investors called the footage 'strong founder visibility.'" },
  { title: "The servers started a cult.", body: "The outage page now asks users to believe in themselves and upgrade." },
];

const botAnswers = {
  "Name Rush": ["Regretify Junior", "OxyRent", "NapRank Ultra", "GuiltShake Plus"],
  "Buzzword Blender": ["premium oxygen flywheel", "AI-powered regret cult", "family-safe homework dashboard"],
  "PR Disaster Sprint": [
    "We regret that customers interpreted our loyalty program as legally binding.",
    "The mascot acted alone, except for the roadmap.",
    "We are pausing harm until the next funding round.",
  ],
  "Logo Drawing": [
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ],
  "One Word Feeling": [
    "Chaotic",
    "Doomed",
    "Profitable",
  ],
  "Exit Strategy": [
    "IPO at the bottom of the market",
    "Acquire a competitor's lawsuits",
    "Go public with private regrets",
  ],
};

function allowCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function json(res, status, data) {
  allowCors(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function makeId(prefix = "p") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function makeRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const code = makeRoomCode();
  const room = {
    code,
    hostId: null,
    phase: "lobby",
    players: [],
    spectators: 0,
    theme: null,
    roundIndex: 0,
    roundEndsAt: null,
    submissions: {},
    votes: {},
    winners: [],
    event: null,
    scores: {},
    createdAt: Date.now(),
    clients: new Set(),
    timer: null,
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(String(code || "").toUpperCase());
}

function publicRoom(room) {
  const currentRound = rounds[room.roundIndex] || null;
  const revealVisible = ["reveal", "vote", "event", "final"].includes(room.phase);
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    players: room.players.map(({ id, name, connected, bot }) => ({ id, name, connected, bot: Boolean(bot) })),
    spectators: room.spectators,
    theme: room.theme,
    roundIndex: room.roundIndex,
    roundCount: rounds.length,
    currentRound,
    roundEndsAt: room.roundEndsAt,
    ready: Object.fromEntries(Object.keys(room.submissions).map((id) => [id, true])),
    submissions: revealVisible ? room.submissions : {},
    votes: room.votes,
    winners: room.winners,
    event: room.event,
    scores: room.scores,
  };
}

function broadcast(room) {
  const payload = `data: ${JSON.stringify(publicRoom(room))}\n\n`;
  for (const client of room.clients) {
    client.write(payload);
  }
}

function schedule(room, delay, fn) {
  clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    fn();
    broadcast(room);
  }, delay);
}

function activePlayers(room) {
  return room.players.filter((player) => player.connected || player.bot);
}

function adaptiveSeconds(room, round) {
  const count = activePlayers(room).length;
  const smallRoomTrim = count <= 2 ? -4 : 0;
  const playerBonus = Math.min(12, Math.max(0, count - 3) * 3);
  const typeBonus = round.type === "text" ? 4 : round.type === "combo" ? 0 : 8;
  return Math.max(22, round.seconds + smallRoomTrim + playerBonus + typeBonus);
}

function startShow(room) {
  room.phase = "intro";
  room.theme = pick(themes);
  room.roundIndex = 0;
  room.submissions = {};
  room.votes = {};
  room.winners = [];
  room.scores = Object.fromEntries(room.players.map((player) => [player.id, 0]));
  room.event = null;
  room.roundEndsAt = null;
  broadcast(room);
  schedule(room, 2200, () => {
    room.phase = "theme";
    schedule(room, 2600, () => beginRound(room));
  });
}

function beginRound(room) {
  const round = rounds[room.roundIndex];
  if (!round) return finishGame(room);
  room.phase = "challenge";
  room.submissions = {};
  room.votes = {};
  room.event = null;
  room.roundEndsAt = Date.now() + adaptiveSeconds(room, round) * 1000;
  schedule(room, room.roundEndsAt - Date.now(), () => finishRound(room));
}

function submit(room, playerId, answer) {
  if (room.phase !== "challenge") return;
  const player = room.players.find((item) => item.id === playerId);
  if (!player) return;
  const round = rounds[room.roundIndex];
  room.submissions[playerId] = {
    playerId,
    playerName: player.name,
    answer: String(answer || pick(round.fallback || ["Untitled Liability"])).slice(0, 220),
  };
  adjustPacing(room);
  broadcast(room);
}

function adjustPacing(room) {
  const active = activePlayers(room);
  const submitted = active.filter((player) => room.submissions[player.id]);
  const remaining = active.length - submitted.length;
  if (active.length > 0 && remaining === 0) {
    schedule(room, 450, () => finishRound(room));
    return;
  }
  if (remaining === 1 && room.roundEndsAt && room.roundEndsAt - Date.now() > 9000) {
    room.roundEndsAt = Date.now() + 9000;
    schedule(room, 9000, () => finishRound(room));
  }
}

function finishRound(room) {
  if (room.phase !== "challenge") return;
  const round = rounds[room.roundIndex];
  for (const player of activePlayers(room)) {
    if (!room.submissions[player.id]) {
      room.submissions[player.id] = {
        playerId: player.id,
        playerName: player.name,
        answer: player.bot ? pick(botAnswers[round.title] || round.fallback || ["BadCo"]) : pick(round.fallback || ["Untitled Liability"]),
      };
    }
  }
  room.phase = "reveal";
  room.roundEndsAt = null;
}

function openVote(room) {
  if (room.phase !== "reveal") return;

  room.phase = "vote";
  room.votes = {};

  const submissionIds = Object.keys(room.submissions);

  for (const player of room.players) {
    if (!player.bot) continue;

    const validTargets = submissionIds.filter(
      (id) => id !== player.id
    );

    if (validTargets.length > 0) {
      room.votes[player.id] = pick(validTargets);
    }
  }

  broadcast(room);

  const active = activePlayers(room);

  const votedCount = active.filter(
    (player) => room.votes[player.id]
  ).length;

  if (votedCount >= active.length) {
    finishVoting(room);
    broadcast(room);
  }
}

function vote(room, voterId, targetId) {
  if (
    room.phase !== "vote" ||
    !room.submissions[targetId] ||
    voterId === targetId
  ) {
    return;
  }

  room.votes[voterId] = targetId;

  const active = activePlayers(room);

  const votedCount = active.filter(
    (player) => room.votes[player.id]
  ).length;

  // Everyone voted -> immediately finish and broadcast
  if (votedCount >= active.length) {
    finishVoting(room);
    broadcast(room);
  }
}

function finishVoting(room) {
  const counts = {};
  for (const target of Object.values(room.votes)) counts[target] = (counts[target] || 0) + 1;
  const winnerId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || Object.keys(room.submissions)[0];
  const submission = room.submissions[winnerId];
  const points = 120 + room.roundIndex * 30 + (counts[winnerId] || 0) * 25;
  room.scores[winnerId] = (room.scores[winnerId] || 0) + points;
  room.winners.push({ playerId: winnerId, playerName: submission.playerName, answer: submission.answer, round: rounds[room.roundIndex].title, points });
  room.event = pick(events);
  room.phase = "event";
}

function nextRound(room) {
  if (room.phase !== "event") return;
  room.roundIndex += 1;
  if (room.roundIndex >= rounds.length) finishGame(room);
  else beginRound(room);
}

function finishGame(room) {
  room.phase = "final";
  room.roundEndsAt = null;
}

function addBot(room, name) {
  const id = makeId("bot");
  room.players.push({ id, name: name || `Bot ${room.players.length + 1}`, connected: true, bot: true });
  room.scores[id] = 0;
}

function botSubmitAll(room) {
  if (room.phase !== "challenge") return;
  const round = rounds[room.roundIndex];
  for (const player of activePlayers(room)) {
    if (!room.submissions[player.id]) submit(room, player.id, pick(botAnswers[round.title] || round.fallback || ["BadCo"]));
  }
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

async function handleApi(req, res, pathname) {
  try {
    if (req.method === "OPTIONS") {
      allowCors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && pathname === "/api/config") {
      return json(res, 200, { rounds, themes });
    }
    if (req.method === "POST" && pathname === "/api/rooms") {
      const room = createRoom();
      return json(res, 200, { room: publicRoom(room), hostId: room.hostId });
    }

    const match = pathname.match(/^\/api\/rooms\/([A-Z0-9]{4})(?:\/(events|join|action))?$/i);
    if (!match) return json(res, 404, { error: "Not found" });
    const room = getRoom(match[1]);
    if (!room) return json(res, 404, { error: "Room not found" });
    const route = match[2];

    if (req.method === "GET" && !route) return json(res, 200, { room: publicRoom(room) });

    if (req.method === "GET" && route === "events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      room.clients.add(res);
      res.write(`data: ${JSON.stringify(publicRoom(room))}\n\n`);
      req.on("close", () => room.clients.delete(res));
      return;
    }

    if (req.method === "POST" && route === "join") {
      const body = await readJson(req);
      let player = body.playerId ? room.players.find((item) => item.id === body.playerId) : null;
      if (player) {
        player.connected = true;
        if (body.name) player.name = String(body.name || player.name).slice(0, 18);
      }
      if (!player) {
        if (!body.name) return json(res, 400, { error: "Name is required to join" });
        player = { id: body.playerId || makeId("p"), name: String(body.name).slice(0, 18), connected: true, bot: false };
        room.players.push(player);
        room.scores[player.id] = room.scores[player.id] || 0;
        if (!room.hostId && !player.bot) room.hostId = player.id;
      }
      broadcast(room);
      return json(res, 200, { room: publicRoom(room), playerId: player.id });
    }

    if (req.method === "POST" && route === "action") {
      const body = await readJson(req);
      const isPlayerHost = body.clientId === room.hostId;
      const isScreenHost = body.clientId && body.clientId.startsWith("host");
      if (body.type === "start" && isPlayerHost) startShow(room);
      if (body.type === "submit") submit(room, body.playerId, body.answer);
      if (body.type === "openVote" && isPlayerHost) openVote(room);
      if (body.type === "vote") vote(room, body.voterId || body.playerId || makeId("aud"), body.targetId);
      if (body.type === "next" && isPlayerHost) nextRound(room);
      if (body.type === "reset" && isPlayerHost) {
        room.phase = "lobby";
        room.roundIndex = 0;
        room.submissions = {};
        room.votes = {};
        room.winners = [];
        room.roundEndsAt = null;
        clearTimeout(room.timer);
      }
      if (body.type === "addBot" && (isPlayerHost || isScreenHost)) addBot(room, body.name);
      if (body.type === "fillBots" && (isPlayerHost || isScreenHost)) {
        ["Mira", "Jax", "Tina", "Omar", "Zoe", "Bean"].forEach((name) => {
          if (!room.players.some((player) => player.name === name)) addBot(room, name);
        });
      }
      if (body.type === "botSubmitAll" && (isPlayerHost || isScreenHost)) botSubmitAll(room);
      if (body.type === "forceNext" && (isPlayerHost || isScreenHost)) {
        if (room.phase === "challenge") finishRound(room);
        else if (room.phase === "reveal") openVote(room);
        else if (room.phase === "vote") finishVoting(room);
        else if (room.phase === "event") nextRound(room);
      }
      if (body.type === "disconnectOne" && (isPlayerHost || isScreenHost)) {
        const target = room.players.find((player) => !player.bot && player.connected) || room.players.find((player) => player.connected);
        if (target) target.connected = false;
      }
      broadcast(room);
      return json(res, 200, { room: publicRoom(room) });
    }

    return json(res, 404, { error: "Not found" });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
}

function serveStatic(req, res, pathname) {
  const cleanUrl = pathname === "/" || pathname === "/host" ? "/index.html" : pathname;
  const file = path.normalize(path.join(root, cleanUrl));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      fs.readFile(path.join(root, "index.html"), (fallbackError, fallbackData) => {
        if (fallbackError) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fallbackData);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "text/plain; charset=utf-8" });
    res.end(data);
  });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return handleApi(req, res, url.pathname);
    serveStatic(req, res, url.pathname);
  })
  .listen(port, "0.0.0.0", () => {
    console.log(`Evil Startups is running at http://127.0.0.1:${port}`);
  });
