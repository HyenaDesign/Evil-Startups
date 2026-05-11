const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const client = {
  role: "host",
  room: null,
  hostId: null,
  playerId: localStorage.getItem("evilStartupsPlayerId") || "",
  apiBase: "",
  apiBaseSource: "",
  eventSource: null,
  countdown: null,
  poller: null,
  sound: true,
  voted: false,
  lastPhase: "",
  networkError: false,
};

const marketBits = [
  ["IPO Noise", "+420%"],
  ["Lawsuit Futures", "Rising"],
  ["Audience Approval", "Unstable"],
  ["Shareholder Screams", "Bullish"],
  ["Regulator Sweat", "High"],
  ["Mascot Merch", "Sold Out"],
];

const audienceReactions = [
  "Shareholders gasp",
  "Legal has left",
  "Ad test wins",
  "Mascot approved",
  "Focus group confused",
  "Stock inexplicably up",
];

async function init() {
  bindStaticEvents();
  const params = new URLSearchParams(location.search);
  const apiParam = params.get("api")?.trim() || "";
  client.apiBase = (window.EVIL_API_BASE || apiParam || "").trim().replace(/\/+$/, "");
  client.apiBaseSource = apiParam ? "query" : "";
  if (!client.apiBase && !["localhost", "127.0.0.1"].includes(location.hostname)) {
    client.apiBase = "https://evil-startups.onrender.com";
    client.apiBaseSource = "default";
  }
  const roomCode = params.get("room");
  if (roomCode) {
    client.role = "player";
    await bootPlayer(roomCode.toUpperCase());
  } else {
    await bootHost();
  }
}

function bindStaticEvents() {
  $("#soundToggle").addEventListener("click", () => {
    client.sound = !client.sound;
    $("#soundToggle").textContent = client.sound ? "Sound On" : "Sound Off";
  });
  $$(".mode-card").forEach((button) =>
    button.addEventListener("click", () => {
      $$(".mode-card").forEach((card) => card.classList.toggle("is-selected", card === button));
      client.mode = button.dataset.mode;
      toast(button.dataset.mode === "jackbox" ? "Host-screen mode active." : "Table mode enabled for local play.");
    }),
  );
  const qrToggle = $("#showQr");
  if (qrToggle) {
    qrToggle.addEventListener("click", () => {
      const qr = $("#joinQr");
      if (!qr) return;
      const visible = qr.classList.toggle("is-visible");
      qrToggle.textContent = visible ? "Hide QR" : "QR";
    });
  }
}

async function bootHost() {
  try {
    const response = await postJson("/api/rooms", {});
    client.hostId = response.hostId;
    connectToRoom(response.room.code);
    $("#joinUrl").textContent = joinUrl(response.room.code);
    bindHostControls();
  } catch (error) {
    console.error("Host initialization failed", error);
    setPhase("lobby");
    showNetworkError("Unable to start host session. Confirm the backend is reachable.");
  }
}

async function bootPlayer(code) {
  $("#roomCode").textContent = code;
  setPhase("controller");
  renderJoinController(code);
  connectToRoom(code);

  if (client.playerId) {
    try {
      const name = localStorage.getItem("evilStartupsName");
      const response = await postJson(`/api/rooms/${code}/join`, { playerId: client.playerId, name });
      client.playerId = response.playerId;
      localStorage.setItem("evilStartupsPlayerId", client.playerId);
      if (response.player.name) localStorage.setItem("evilStartupsName", response.player.name);
      client.room = response.room;
      renderController();
    } catch (error) {
      console.info("Reconnect attempt failed, keeping join screen", error);
    }
  }
}

function bindHostControls() {
  $("#addPlayer").addEventListener("click", () => {
    const name = $("#playerInput").value.trim() || `Bot ${Date.now().toString().slice(-2)}`;
    $("#playerInput").value = "";
    hostAction("addBot", { name });
  });
  $("#playerInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("#addPlayer").click();
  });
  $("#demoFill").addEventListener("click", () => hostAction("fillBots"));
  $("#startShow").addEventListener("click", () => hostAction("start"));
  $("#continueToVote").addEventListener("click", () => hostAction("openVote"));
  $("#nextRound").addEventListener("click", () => hostAction("next"));
  $("#playAgain").addEventListener("click", () => hostAction("reset"));
  $("#copyRecap").addEventListener("click", copyRecap);
  $("#devBotSubmit").addEventListener("click", () => hostAction("botSubmitAll"));
  $("#devForceNext").addEventListener("click", () => hostAction("forceNext"));
  $("#devDisconnect").addEventListener("click", () => hostAction("disconnectOne"));
}

function connectToRoom(code) {
  if (client.eventSource) client.eventSource.close();
  if (client.poller) {
    clearInterval(client.poller);
    client.poller = null;
  }

  const endpoint = apiUrl(`/api/rooms/${code}/events`);
  client.eventSource = new EventSource(endpoint);
  client.eventSource.onopen = () => {
    clearNetworkError();
    if (client.poller) {
      clearInterval(client.poller);
      client.poller = null;
    }
  };
  client.eventSource.onmessage = (event) => {
    client.room = JSON.parse(event.data);
    client.hostId = client.room.hostId;
    render();
  };
  client.eventSource.onerror = () => {
    if (!client.networkError) {
      showNetworkError("Realtime connection lost. Retrying...");
    }
    if (!client.poller) {
      client.poller = setInterval(() => refreshRoom(code), 3000);
    }
  };
}

function render() {
  if (!client.room) return;
  if (client.lastPhase !== client.room.phase) {
    if (client.room.phase === "challenge") {
      client.voted = false;
      if (client.mode === "table") client.tableTurn = 0;
    }
    if (client.room.phase === "vote") client.voted = false;
    client.lastPhase = client.room.phase;
  }
  $("#roomCode").textContent = client.room.code;
  updateJoinLink();
  if (client.role === "player") {
    renderController();
    return;
  }
  renderHost();
}

function renderHost() {
  const room = client.room;
  if (room.phase === "lobby") renderLobby();
  if (room.phase === "intro") renderIntro();
  if (room.phase === "theme") renderTheme();
  if (room.phase === "challenge") renderChallengeHost();
  if (room.phase === "reveal") renderReveal();
  if (room.phase === "vote") renderVoteHost();
  if (room.phase === "event") renderEvent();
  if (room.phase === "final") renderFinal();
}

function renderLobby() {
  setPhase("lobby");
  renderPlayers();
  const count = client.room.players.length;
  $("#startShow").disabled = count < 2;
  $("#startShow").textContent = count < 2 ? "Need 2 Players" : "Start Show";
}

function renderPlayers() {
  const players = client.room.players;
  $("#playerChips").innerHTML = players.length
    ? players
        .map((player) => `<span class="chip ${player.connected ? "" : "is-offline"}">${escapeHtml(player.name)}${player.bot ? " BOT" : ""}</span>`)
        .join("")
    : `<span class="chip">Waiting for players...</span>`;
}

function renderIntro() {
  setPhase("intro");
  $("#introHeadline").textContent = `${client.room.players.length} founders joined. The host is legally excited.`;
}

function renderTheme() {
  setPhase("theme");
  $("#themeTitle").textContent = client.room.theme?.title || "Loading terrible opportunity...";
  $("#themeTags").innerHTML = (client.room.theme?.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
}

function renderChallengeHost() {
  const round = client.room.currentRound;
  setPhase("challenge");
  $("#roundLabel").textContent = `Round ${client.room.roundIndex + 1} of ${client.room.roundCount}`;
  $("#challengeTitle").textContent = round.title;
  $("#challengePrompt").textContent = round.prompt;
  const pendingPlayers = activePlayers().filter((player) => !client.room.submissions[player.id]);
  const currentTablePlayer = pendingPlayers[Math.min(client.tableTurn || 0, pendingPlayers.length - 1)];
  if (client.mode === "table" && currentTablePlayer) {
    $("#interactionMount").innerHTML = `
      <div class="controller-wait">
        <strong>Table mode — submit for ${escapeHtml(currentTablePlayer.name)}</strong>
        <textarea id="tableAnswer" rows="4" placeholder="${escapeHtml(round.placeholder || "Type your answer")}"></textarea>
        <button id="tableSubmit" class="mega-button" type="button">Submit for ${escapeHtml(currentTablePlayer.name)}</button>
        <div style="margin-top:14px;font-size:0.95rem;color:rgba(21,16,25,0.68)">Pass the device to the next player after submission.</div>
      </div>
    `;
    $("#tableSubmit").addEventListener("click", async () => {
      const answer = $("#tableAnswer").value.trim();
      if (!answer) return toast("Type something for the player.");
      const success = await postJson(`/api/rooms/${client.room.code}/action`, { type: "submit", playerId: currentTablePlayer.id, answer });
      if (success) {
        client.tableTurn = Math.min((client.tableTurn || 0) + 1, pendingPlayers.length);
        renderChallengeHost();
      }
    });
  } else {
    $("#interactionMount").innerHTML = `
      <div class="controller-wait">
        Waiting for phone submissions...
        <br />
        <span>${submittedCount()} / ${activePlayers().length} locked in</span>
        <div class="lobby-actions" style="justify-content:center;margin-top:14px">
          <button id="roundBotSubmit" class="secondary-button" type="button">Bot Submit</button>
          <button id="roundForceNext" class="secondary-button" type="button">Force Reveal</button>
        </div>
      </div>
    `;
    $("#roundBotSubmit").addEventListener("click", () => hostAction("botSubmitAll"));
    $("#roundForceNext").addEventListener("click", () => hostAction("forceNext"));
  }
  $("#hostLine").textContent = oneRemaining()
    ? "One founder remains. The timer is now politely threatening them."
    : "Players are submitting privately. The reveal is where the damage happens.";
  renderPlayerStatus();
  startCountdown();
}

function renderPlayerStatus() {
  $("#playerStatus").innerHTML = client.room.players
    .map((player) => `<span class="status-chip ${client.room.ready[player.id] ? "is-ready" : ""}">${escapeHtml(player.name)} ${client.room.ready[player.id] ? "Ready" : player.connected ? "Thinking" : "Offline"}</span>`)
    .join("");
}

function renderReveal() {
  setPhase("reveal");
  stopCountdown();
  $("#revealTitle").textContent = revealHeadline(client.room.currentRound.type);
  $("#marketReaction").innerHTML = marketReactionMarkup();
  $("#revealCards").innerHTML = submissions()
    .map(
      (submission) => `
        <article class="reveal-card">
          <h3>${escapeHtml(submission.playerName)}</h3>
          ${
            submission.answer.startsWith("data:image")
              ? `<img src="${escapeHtml(submission.answer)}" alt="Drawing" style="max-width: 100%; max-height: 200px;">`
              : `<p>${escapeHtml(submission.answer)}</p>`
          }
          <span class="ad-stamp">${escapeHtml(fakeAudienceReaction(submission.answer))}</span>
        </article>
      `,
    )
    .join("");
  burstConfetti(10);
}

function renderVoteHost() {
  setPhase("vote");
  $("#voteCards").innerHTML = submissions()
    .map(
      (submission) => `
      <article class="vote-card" data-player="${escapeHtml(submission.playerId)}">
        <h3>${escapeHtml(submission.playerName)}</h3>
        ${
          submission.answer.startsWith("data:image")
            ? `<img src="${escapeHtml(submission.answer)}" alt="Drawing" style="max-width: 100%; max-height: 150px;">`
            : `<p>${escapeHtml(submission.answer)}</p>`
        }
        <span class="ad-stamp">${escapeHtml(fakeAudienceReaction(submission.answer))}</span>
        <span class="vote-count">${voteCountFor(submission.playerId)}</span>
      </article>
    `,
    )
    .join("");
  if (client.role === "host") {
    $$(".vote-card").forEach((card) =>
      card.addEventListener("click", () => hostAction("vote", {
  voterId: client.hostId,
  targetId: card.dataset.player
})),
    );
  }
}

function renderEvent() {
  setPhase("event");
  $("#eventTitle").textContent = client.room.event?.title || "Breaking News";
  $("#eventBody").textContent = client.room.event?.body || "The host has nothing useful to add, which has never stopped them.";
  if (client.room.roundIndex + 1 >= client.room.roundCount) {
    $("#nextRound").textContent = "See Results";
  } else {
    $("#nextRound").textContent = "Next Round";
  }
  burstConfetti(8);
}

function renderFinal() {
  setPhase("final");
  const standings = standingsForRoom();
  const winner = standings[0];
  $("#winnerTitle").textContent = `${winner?.name || "Nobody"} wins the fake IPO.`;
  $("#scoreboard").innerHTML = standings
    .map(
      (entry) => `
      <article class="score-card">
        <h3>${escapeHtml(entry.name)}</h3>
        <strong>${entry.score}</strong>
        <p>${escapeHtml(titleForScore(entry.score))}</p>
      </article>
    `,
    )
    .join("");
  $("#finalStory").textContent = buildFinalStory(winner);
  burstConfetti(28);
}

function renderJoinController(code) {
  $("#controllerTitle").textContent = `Join ${code}`;
  $("#controllerStatus").textContent = "Type your name. The host screen will update live.";
  $("#controllerMount").innerHTML = `
    <div class="controller-actions">
      <input id="controllerName" maxlength="18" placeholder="Your name" />
      <button id="joinRoom" class="mega-button" type="button">Join Room</button>
    </div>
  `;
  $("#joinRoom").addEventListener("click", async () => {
    const name = $("#controllerName").value.trim();
    if (!name) return toast("Enter a name first.");
    try {
      const response = await postJson(`/api/rooms/${code}/join`, { name, playerId: client.playerId });
      client.playerId = response.playerId;
      localStorage.setItem("evilStartupsPlayerId", client.playerId);
      localStorage.setItem("evilStartupsName", response.player.name);
      client.room = response.room;
      renderController();
    } catch (error) {
      console.error("Join failed", error);
    }
  });
}

function renderController() {
  const room = client.room;
  setPhase("controller");
  const me = room.players.find((player) => player.id === client.playerId);
  if (!me) return renderJoinController(room.code);
  $("#controllerTitle").textContent = me.name;

  if (room.phase === "lobby") {
    if (client.playerId === client.hostId) {
      $("#controllerStatus").textContent = "You are the host! Start the show when ready.";
      $("#controllerMount").innerHTML = `
        <div class="controller-actions">
          <button id="controllerStart" class="mega-button" type="button">Start Show</button>
          <button id="controllerAddBot" class="secondary-button" type="button">Add Bot</button>
          <button id="controllerFill" class="mini-button" type="button">Fill Party</button>
          <button id="controllerBotSubmit" class="mini-button" type="button">Bot Submit</button>
          <button id="controllerForceNext" class="mini-button" type="button">Force Next</button>
        </div>
      `;
      $("#controllerStart").addEventListener("click", () => hostAction("start"));
      $("#controllerAddBot").addEventListener("click", () => {
        const name = prompt("Bot name:");
        if (name) hostAction("addBot", { name });
      });
      $("#controllerFill").addEventListener("click", () => hostAction("fillBots"));
      $("#controllerBotSubmit").addEventListener("click", () => hostAction("botSubmitAll"));
      $("#controllerForceNext").addEventListener("click", () => hostAction("forceNext"));
    } else {
      $("#controllerStatus").textContent = "You are in. Watch the host screen for the show.";
      $("#controllerMount").innerHTML = `<div class="controller-wait">Waiting for the host to start...</div>`;
    }
    return;
  }

  if (room.phase === "challenge") {
    renderControllerChallenge(room.currentRound);
    return;
  }

  if (room.phase === "vote") {
    renderControllerVote();
    return;
  }

if (room.phase === "reveal" && client.playerId === client.hostId) {
  $("#controllerStatus").textContent = "Open voting when everyone has seen the answers.";

  $("#controllerMount").innerHTML = `
    <div class="controller-actions">
      <button id="openVoting" class="mega-button" type="button">
        Open Voting
      </button>
    </div>
  `;

  $("#openVoting").addEventListener("click", () => hostAction("openVote"));

  return;
}

  $("#controllerStatus").textContent = controllerStatusFor(room.phase);
  $("#controllerMount").innerHTML = `<div class="controller-wait">${escapeHtml(controllerStatusFor(room.phase))}</div>`;
}

function initDrawing() {
  const canvas = $("#drawCanvas");
  const ctx = canvas.getContext("2d");
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#000";
  let drawing = false;
  let lastX = 0;
  let lastY = 0;

  function startDrawing(e) {
    drawing = true;
    [lastX, lastY] = getCoords(e);
  }

  function draw(e) {
    if (!drawing) return;
    const [x, y] = getCoords(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    [lastX, lastY] = [x, y];
  }

  function stopDrawing() {
    drawing = false;
  }

  function getCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
  }

  canvas.addEventListener("mousedown", startDrawing);
  canvas.addEventListener("mousemove", draw);
  canvas.addEventListener("mouseup", stopDrawing);
  canvas.addEventListener("mouseout", stopDrawing);

  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    startDrawing(e.touches[0]);
  });
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    draw(e.touches[0]);
  });
  canvas.addEventListener("touchend", stopDrawing);
}

function renderControllerChallenge(round) {
  const submitted = client.room.ready[client.playerId];
  $("#controllerStatus").textContent = `${round.title}: ${round.prompt}`;
  if (submitted) {
    $("#controllerMount").innerHTML = `<div class="controller-wait">Locked in. Prepare to be judged.</div>`;
    return;
  }
  if (round.type === "combo") {
    $("#controllerMount").innerHTML = `
      <div class="controller-choice-grid">
        ${round.columns
          .map(
            (column, index) => `
            <select data-combo="${index}">
              <option value="">Pick ${index + 1}</option>
              ${column.map((word) => `<option>${escapeHtml(word)}</option>`).join("")}
            </select>
          `,
          )
          .join("")}
        <button id="submitCombo" class="mega-button" type="button">Lock Buzzwords</button>
      </div>
    `;
    $("#submitCombo").addEventListener("click", () => {
      const answer = $$("[data-combo]").map((select) => select.value).filter(Boolean).join(" ");
      if (!answer) return toast("Pick at least one terrible buzzword.");
      playerAction("submit", { answer });
    });
    return;
  }
if (round.type === "draw") {
  $("#controllerMount").innerHTML = `
    <div class="controller-actions">
      <canvas
        id="drawCanvas"
        width="320"
        height="320"
        style="
          width: 100%;
          max-width: 320px;
          height: 320px;
          background: white;
          border-radius: 18px;
          border: 3px solid rgba(0,0,0,0.15);
          touch-action: none;
          display: block;
          margin: 0 auto 16px;
        "
      ></canvas>

      <button id="clearCanvas" class="secondary-button" type="button">
        Clear
      </button>

      <button id="submitDrawing" class="mega-button" type="button">
        Submit Drawing
      </button>
    </div>
  `;

  initDrawing();

  $("#clearCanvas").addEventListener("click", () => {
    const canvas = $("#drawCanvas");
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });

  $("#submitDrawing").addEventListener("click", () => {
    const canvas = $("#drawCanvas");
    const answer = canvas.toDataURL(
  "image/jpeg",
  0.7
);

    playerAction("submit", { answer });
  });

  return;
}
  const drawCanvas = $("#drawCanvas");

if (drawCanvas) {
  drawCanvas.style.display = "none";
}
  $("#controllerMount").innerHTML = `
    <div class="controller-actions">
      <textarea id="controllerAnswer" rows="4" placeholder="${escapeHtml(round.placeholder || "Type your answer")}"></textarea>
      <button id="submitAnswer" class="mega-button" type="button">Submit</button>
    </div>
  `;
  $("#submitAnswer").addEventListener("click", () => {
    const answer = $("#controllerAnswer").value.trim();
    if (!answer) return toast("Give the host something to roast.");
    playerAction("submit", { answer });
  });
}

function renderControllerVote() {
  if (client.voted) {
    $("#controllerStatus").textContent = "Vote locked.";
    $("#controllerMount").innerHTML = `<div class="controller-wait">Waiting for the rest of the room...</div>`;
    return;
  }
  $("#controllerStatus").textContent = "Vote for the funniest pitch.";
  $("#controllerMount").innerHTML = `
    <div class="controller-choice-grid">
      ${submissions()
        .map((submission) => `<button class="choice-card" type="button" data-vote="${escapeHtml(submission.playerId)}">${escapeHtml(submission.playerName)}: ${escapeHtml(submission.answer)}</button>`)
        .join("")}
    </div>
  `;
  $$("[data-vote]").forEach((button) =>
    button.addEventListener("click", async () => {
      const targetId = button.dataset.vote;
      const success = await playerAction("vote", { targetId, voterId: client.playerId });
      if (success) {
        client.voted = true;
        renderController();
      }
    }),
  );
}

function startCountdown() {
  stopCountdown();
  updateCountdown();
  client.countdown = setInterval(updateCountdown, 250);
}

function stopCountdown() {
  clearInterval(client.countdown);
}

function updateCountdown() {
  if (!client.room?.roundEndsAt) return;
  const seconds = Math.max(0, Math.ceil((client.room.roundEndsAt - Date.now()) / 1000));
  const total = Math.max(1, client.room.currentRound.seconds);
  $("#timerText").textContent = seconds;
  $("#timerArc").style.strokeDashoffset = String(327 - 327 * Math.min(1, seconds / total));
  if (seconds <= 5 && seconds > 0) playBeep(340 + (6 - seconds) * 65, 0.025);
}

function hostAction(type, payload = {}) {
  return action({ type, clientId: client.hostId, ...payload });
}

function playerAction(type, payload = {}) {
  return action({ type, playerId: client.playerId, ...payload });
}

async function action(payload) {
  if (!client.room) return false;
  try {
    await postJson(`/api/rooms/${client.room.code}/action`, payload);
    return true;
  } catch (error) {
    toast("Action failed. Please retry.");
    return false;
  }
}

async function postJson(url, payload) {
  const fullUrl = apiUrl(url);
  try {
    const response = await fetch(fullUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      const message = `Server error ${response.status}: ${text || response.statusText}`;
      console.error(message, { url: fullUrl, payload, status: response.status, body: text });
      throw new Error(message);
    }
    clearNetworkError();
    return response.json();
  } catch (error) {
    console.error("postJson failed", { url: fullUrl, payload, error });
    showNetworkError("Could not reach the game server. Check backend and refresh.");
    throw error;
  }
}

function submissions() {
  return Object.values(client.room?.submissions || {});
}

function activePlayers() {
  return (client.room?.players || []).filter((player) => player.connected || player.bot);
}

function submittedCount() {
  return Object.keys(client.room?.ready || {}).length;
}

function oneRemaining() {
  return activePlayers().length - submittedCount() === 1;
}

function voteCountFor(playerId) {
  return Object.values(client.room?.votes || {}).filter((target) => target === playerId).length;
}

function standingsForRoom() {
  return [...(client.room?.players || [])]
    .map((player) => ({ ...player, score: client.room.scores[player.id] || 0 }))
    .sort((a, b) => b.score - a.score);
}

function buildFinalStory(winner) {
  const best = client.room.winners.find((entry) => entry.playerId === winner?.id) || client.room.winners[0];
  return `Tonight, ${winner?.name || "the room"} helped invent ${client.room.theme?.title?.toLowerCase() || "a suspicious business"} and somehow made "${best?.answer || "a suspicious dashboard"}" sound investable. Analysts predict one apology, two charts, and a mascot with a podcast.`;
}

function copyRecap() {
  const standings = standingsForRoom();
  const text = [
    "Evil Startups recap",
    `Room: ${client.room.code}`,
    `Theme: ${client.room.theme?.title || "Unknown"}`,
    `Winner: ${standings[0]?.name || "Nobody"} (${standings[0]?.score || 0} points)`,
    ...client.room.winners.map((winner) => `${winner.playerName} won ${winner.round} with "${winner.answer}".`),
  ].join("\n");
  navigator.clipboard?.writeText(text).then(() => toast("Recap copied."));
}

function joinUrl(code) {
  const url = new URL(location.href);
  url.searchParams.set("room", code);
  if (client.apiBaseSource === "query") url.searchParams.set("api", client.apiBase);
  return url.toString();
}

function updateJoinLink() {
  const link = joinUrl(client.room.code);
  $("#joinUrl").textContent = link;
  const qr = $("#joinQr");
  if (qr) {
    qr.innerHTML = `<img src="${qrImageUrl(link)}" alt="Join QR code" />`;
  }
}

function qrImageUrl(text) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(text)}`;
}

function setPhase(phase) {
  $("#app").dataset.phase = phase;
  $$(".screen").forEach((screen) => screen.classList.remove("is-active"));
  $(`#${phase}Screen`).classList.add("is-active");
}

function apiUrl(path) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return client.apiBase ? `${client.apiBase}${normalized}` : normalized;
}

async function refreshRoom(code) {
  try {
    const response = await fetch(apiUrl(`/api/rooms/${code}`), { method: "GET" });
    if (!response.ok) throw new Error(`Refresh failed ${response.status}`);
    const json = await response.json();
    client.room = json.room || json;
    render();
    clearNetworkError();
  } catch (error) {
    console.warn("refreshRoom failed", error);
    showNetworkError("Waiting for game state. Reconnecting...");
  }
}

function showNetworkError(message) {
  client.networkError = true;
  const node = $("#networkError");
  if (node) {
    node.textContent = message;
    node.classList.add("is-visible");
  }
  toast(message);
}

function clearNetworkError() {
  client.networkError = false;
  const node = $("#networkError");
  if (node) node.classList.remove("is-visible");
}

function revealHeadline(type) {
  return {
    text: "The answers are in. Please hide your lawyers.",
    combo: "The buzzwords have fused into a product-shaped warning.",
  }[type] || "Dramatic reveal.";
}

function marketReactionMarkup() {
  return Array.from({ length: 3 }, () => pick(marketBits))
    .map(([label, value]) => `<div class="market-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
}

function fakeAudienceReaction(answer) {
  if (String(answer).length > 42) return "Too long, still funded";
  return pick(audienceReactions);
}

function controllerStatusFor(phase) {
  return {
    intro: "Show starting. Look at the host screen.",
    theme: "Theme reveal. Prepare a terrible idea.",
    reveal: "Your answer is on the big screen.",
    event: "Breaking news. The host is making it worse.",
    final: "Game over. Someone has fake shareholder value.",
  }[phase] || "Waiting for host...";
}

function titleForScore(score) {
  if (score > 430) return "VP of Bad Ideas";
  if (score > 220) return "Director of Apologies";
  return "Unpaid Vision Intern";
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function burstConfetti(amount) {
  const root = $(".confetti");
  for (let i = 0; i < amount; i += 1) {
    const bit = document.createElement("i");
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.background = pick(["#ff435d", "#ffe156", "#3bb7ff", "#55d66b", "#ff6bc8"]);
    bit.style.animationDelay = `${Math.random() * 0.3}s`;
    root.appendChild(bit);
    setTimeout(() => bit.remove(), 1500);
  }
}

function playBeep(frequency, duration) {
  if (!client.sound) return;
  try {
    const audio = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.025;
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    setTimeout(() => {
      oscillator.stop();
      audio.close();
    }, duration * 1000);
  } catch {
    client.sound = false;
    $("#soundToggle").textContent = "Sound Off";
  }
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("is-visible");
  setTimeout(() => node.classList.remove("is-visible"), 2600);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

init().catch((error) => {
  console.error(error);
  toast("Could not start realtime room.");
});
