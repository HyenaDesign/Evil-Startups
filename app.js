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
  timeWarningPlayed: false,
  legalWarningPlayed: false,
  roundStartPlayed: false,
  currentAudio: null,
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

// ─── Sound bank ────────────────────────────────────────────────────────────────
// To add new sounds, just drop the filename into the right array.
// pick() will randomise which one plays each time.
const SOUNDS = {
  roundStart:   ["round_start.mp3"],
  roundEnd:     ["end_of_round.mp3", "end_of_round2.mp3", "end_of_round3.mp3", "endofround4.mp3", "endofround5.mp3", "endofround6.mp3", "endofround7.mp3", "endofround8.mp3", "endofround9.mp3", "endofround10.mp3", "endofround11.mp3", "endofround12.mp3", "endofround13.mp3", "endofround14.mp3", "endofround15.mp3", "endofround16.mp3"],
  lastRoundEnd: ["end_of_last_round.mp3"],
  legalWarning: ["legal_warnings.mp3"],
  timeWarning:  ["times_almost_up.mp3", "times_almost_up2.mp3"],
  welcome:      ["welcome.mp3"],
};

// Flat list for preloading — auto-derived from the sound bank above
const PRELOAD_AUDIO = Object.values(SOUNDS).flat();
// ───────────────────────────────────────────────────────────────────────────────

function preloadAudio() {
  PRELOAD_AUDIO.forEach((filename) => {
    const audio = new Audio(`assets/audio/${filename}`);
    audio.load();
  });
}

function startBackgroundMusic() {
  const bg = new Audio("assets/audio/backgroundmusic.mp3");
  bg.loop = true;
  bg.volume = 0.08;
  bg.play().catch((error) => {
    // Browsers block autoplay until the user interacts with the page.
    // Wait for the first click/keydown and try again.
    console.info("Background music blocked, waiting for interaction:", error);
    const retry = () => {
      bg.play().catch(() => {});
      document.removeEventListener("click", retry);
      document.removeEventListener("keydown", retry);
    };
    document.addEventListener("click", retry);
    document.addEventListener("keydown", retry);
  });
  client.bgMusic = bg;
}

async function init() {
  preloadAudio();
  startBackgroundMusic();
  bindStaticEvents();
  const params = new URLSearchParams(location.search);
  const apiParam = params.get("api")?.trim() || "";
  client.apiBase = (window.EVIL_API_BASE || apiParam || "").trim().replace(/\/+$/, "");
  client.apiBaseSource = apiParam ? "query" : "";
  if (!client.apiBase && !["localhost", "127.0.0.1", "evil.local"].includes(location.hostname)) {
    client.apiBase = "https://evil-startups.onrender.com";
    client.apiBaseSource = "default";
  } else if (!client.apiBase) {
    client.apiBase = `http://${location.hostname}:4173`;
    client.apiBaseSource = "local";
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
    if (client.bgMusic) {
      client.sound ? client.bgMusic.play().catch(() => {}) : client.bgMusic.pause();
    }
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
    // Still bind controls so user can retry or see status
    bindHostControls();
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
  $("#addPlayer").addEventListener("click", async () => {
    if (!client.room) {
      toast("Create a room first by clicking 'Start Show'");
      return;
    }
    const name = $("#playerInput").value.trim() || `Bot ${Date.now().toString().slice(-2)}`;
    $("#playerInput").value = "";
    hostAction("addBot", { name });
  });
  $("#playerInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("#addPlayer").click();
  });
  $("#demoFill").addEventListener("click", async () => {
    if (!client.room) {
      toast("Create a room first by clicking 'Start Show'");
      return;
    }
    hostAction("fillBots");
  });
  $("#startShow").addEventListener("click", async () => {
    if (!client.room) {
      // Try to create a room if we don't have one
      try {
        const response = await postJson("/api/rooms", {});
        client.hostId = response.hostId;
        connectToRoom(response.room.code);
        $("#joinUrl").textContent = joinUrl(response.room.code);
        // Now that we have a room, start the show
        hostAction("start");
      } catch (error) {
        console.error("Failed to create room on start", error);
        showNetworkError("Could not start the show. Check backend connection.");
      }
    } else {
      hostAction("start");
    }
  });
  $("#continueToVote").addEventListener("click", () => hostAction("openVote"));
  $("#continueToEvent").addEventListener("click", () => hostAction("leaderboardNext"));
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
      client.timeWarningPlayed = false;
      client.legalWarningPlayed = false;
      client.roundStartPlayed = false;
      if (client.mode === "table") client.tableTurn = 0;
    }
    if (client.room.phase === "vote") client.voted = false;
    if (client.room.phase === "leaderboard") {
      client.leaderboardAnimated = false;
    }
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
  if (room.phase === "leaderboard") renderLeaderboard();
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
  playAudio(pick(SOUNDS.welcome));
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
  if (!client.roundStartPlayed) {
    playAudio(pick(SOUNDS.roundStart));
    client.roundStartPlayed = true;
  }
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
        </article>
      `,
    )
    .join("");
  burstConfetti(10);

  const isLastRound = client.room.roundIndex + 1 >= client.room.roundCount;
  const roundClip = isLastRound ? pick(SOUNDS.lastRoundEnd) : pick(SOUNDS.roundEnd);
  const first = playAudio(roundClip);
  // legal_warnings already played mid-round; nothing to chain here
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

function renderLeaderboard() {
  setPhase("leaderboard");
  const room = client.room;
  const prevScores = room.scoresBeforeRound || {};
  const latestWinner = room.winners[room.winners.length - 1];
  const isLastRound = room.roundIndex + 1 >= room.roundCount;

  // Build standings using CURRENT scores (after round points applied)
  const standings = [...room.players]
    .map((p) => ({
      ...p,
      score: room.scores[p.id] || 0,
      prevScore: prevScores[p.id] || 0,
      gained: (room.scores[p.id] || 0) - (prevScores[p.id] || 0),
    }))
    .sort((a, b) => b.score - a.score);

  // Compute rank change vs previous-round ordering
  const prevRanking = [...room.players]
    .map((p) => ({ id: p.id, score: prevScores[p.id] || 0 }))
    .sort((a, b) => b.score - a.score)
    .map((p) => p.id);

  const currentRanking = standings.map((p) => p.id);

  const rankChange = {};
  currentRanking.forEach((id, idx) => {
    const prev = prevRanking.indexOf(id);
    rankChange[id] = prev - idx; // positive = climbed
  });

  const biggestClimber = standings.reduce((best, p) => {
    return rankChange[p.id] > (rankChange[best?.id] || 0) ? p : best;
  }, null);

  const leader = standings[0];

  $("#leaderboardRoundLabel").textContent = `Round ${room.roundIndex + 1} of ${room.roundCount} — Results`;
  $("#leaderboardWinnerLine").textContent = latestWinner
    ? `🏆 ${escapeHtml(latestWinner.playerName)} wins the round (+${latestWinner.points} pts, ${latestWinner.votes} vote${latestWinner.votes !== 1 ? "s" : ""})`
    : "";
  $("#continueToEvent").textContent = isLastRound ? "See Final Results" : "Next Round";

  const rows = standings
    .map((entry, idx) => {
      const isWinner = entry.id === latestWinner?.playerId;
      const isLeader = entry.id === leader?.id;
      const climbed = rankChange[entry.id] > 0;
      const dropped = rankChange[entry.id] < 0;
      const isBigClimber = biggestClimber && entry.id === biggestClimber.id && rankChange[entry.id] > 0;
      const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}.`;
      const arrow = climbed ? "↑" : dropped ? "↓" : "—";
      const arrowClass = climbed ? "lb-arrow-up" : dropped ? "lb-arrow-down" : "lb-arrow-flat";
      const gainedHtml = entry.gained > 0
        ? `<span class="lb-gained">+${entry.gained}</span>`
        : "";
      const badgeHtml = [
        isWinner ? `<span class="lb-badge lb-badge-winner">Round Win</span>` : "",
        isLeader && standings.length > 1 ? `<span class="lb-badge lb-badge-leader">Leader</span>` : "",
        isBigClimber ? `<span class="lb-badge lb-badge-climb">📈 Big Climb</span>` : "",
      ].join("");

      return `
        <div class="lb-row ${isWinner ? "lb-row-winner" : ""}" data-id="${escapeHtml(entry.id)}" style="animation-delay:${idx * 120}ms">
          <span class="lb-medal">${medal}</span>
          <span class="lb-name">${escapeHtml(entry.name)}${entry.bot ? " <em>BOT</em>" : ""}</span>
          <span class="lb-badges">${badgeHtml}</span>
          <span class="lb-score-wrap">
            <span class="lb-score" data-target="${entry.score}" data-from="${entry.prevScore}">${entry.prevScore}</span>
            ${gainedHtml}
          </span>
          <span class="${arrowClass}">${arrow}</span>
        </div>`;
    })
    .join("");

  $("#leaderboardRows").innerHTML = rows;

  // Animate score counting up (only run once per phase entry)
  if (!client.leaderboardAnimated) {
    client.leaderboardAnimated = true;
    burstConfetti(latestWinner ? 16 : 6);
    setTimeout(() => {
      $$(".lb-score").forEach((el) => {
        const from = parseInt(el.dataset.from, 10);
        const to = parseInt(el.dataset.target, 10);
        if (from === to) return;
        const duration = 900;
        const start = performance.now();
        function step(now) {
          const elapsed = now - start;
          const progress = Math.min(elapsed / duration, 1);
          // Ease-out cubic
          const eased = 1 - Math.pow(1 - progress, 3);
          el.textContent = Math.round(from + (to - from) * eased);
          if (progress < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });
    }, 300);
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

  // Defer sizing until after the browser has laid out the canvas so
  // getBoundingClientRect() returns real dimensions instead of 0×0.
  requestAnimationFrame(() => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const displayW = Math.max(rect.width, 280);
    const displayH = Math.max(rect.height, 280);
    canvas.width = Math.ceil(displayW * dpr);
    canvas.height = Math.ceil(displayH * dpr);
    ctx.scale(dpr, dpr);
    // Fill white so JPEG export has no transparent (black) pixels
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, displayW, displayH);
  });

  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
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
    return [(e.clientX - rect.left), (e.clientY - rect.top)];
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

      <button id="submitDrawing" class="mega-button" type="button" data-submitting="false">
        Submit Drawing
      </button>
    </div>
  `;

  initDrawing();

  $("#clearCanvas").addEventListener("click", () => {
    const canvas = $("#drawCanvas");
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  });

  $("#submitDrawing").addEventListener("click", () => {
    const btn = $("#submitDrawing");
    if (btn.dataset.submitting === "true") return;
    const canvas = $("#drawCanvas");
    const ctx = canvas.getContext("2d");
    // Composite drawing onto a white background so JPEG has no transparent (black) pixels
    const offscreen = document.createElement("canvas");
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    const offCtx = offscreen.getContext("2d");
    offCtx.fillStyle = "#ffffff";
    offCtx.fillRect(0, 0, offscreen.width, offscreen.height);
    offCtx.drawImage(canvas, 0, 0);
    const answer = offscreen.toDataURL("image/jpeg", 0.75);
    btn.dataset.submitting = "true";
    btn.disabled = true;
    playerAction("submit", { answer }).finally(() => {
      btn.dataset.submitting = "false";
      btn.disabled = false;
    });
  });

  return;
}
  const drawCanvas = $("#drawCanvas");

if (drawCanvas) {
  drawCanvas.style.display = "none";
}
  $("#controllerMount").innerHTML = `
    <div class="controller-actions">
      <textarea id="controllerAnswer" rows="4" placeholder="${escapeHtml(round.placeholder || "Type your answer")}" autocomplete="off" spellcheck="false"></textarea>
      <button id="submitAnswer" class="mega-button" type="button" data-submitting="false">Submit</button>
    </div>
  `;
  const submitBtn = $("#submitAnswer");
  const answerInput = $("#controllerAnswer");
  
  // Prevent accidental double-submissions
  submitBtn.addEventListener("click", () => {
    if (submitBtn.dataset.submitting === "true") return;
    const answer = answerInput.value.trim();
    if (!answer) return toast("Give the host something to roast.");
    submitBtn.dataset.submitting = "true";
    submitBtn.disabled = true;
    playerAction("submit", { answer }).finally(() => {
      submitBtn.dataset.submitting = "false";
      submitBtn.disabled = false;
    });
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
        .map((submission) => {
          const isDrawing = String(submission.answer).startsWith("data:image");
          return `
            <button class="choice-card" type="button" data-vote="${escapeHtml(submission.playerId)}">
              <strong>${escapeHtml(submission.playerName)}</strong>
              ${isDrawing
                ? `<img src="${escapeHtml(submission.answer)}" alt="Drawing by ${escapeHtml(submission.playerName)}" style="max-width:100%;max-height:140px;border-radius:14px;"/>`
                : `<span>${escapeHtml(submission.answer)}</span>`}
            </button>`;
        })
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
  const ratio = seconds / total;
  $("#timerText").textContent = seconds;
  $("#timerArc").style.strokeDashoffset = String(327 - 327 * Math.min(1, ratio));

  // Legal warning fires once around the halfway point while the round is still active
  if (ratio <= 0.5 && seconds > 5 && !client.legalWarningPlayed) {
    playAudio(pick(SOUNDS.legalWarning));
    client.legalWarningPlayed = true;
  }

  if (seconds <= 5 && seconds > 0) {
    playBeep(340 + (6 - seconds) * 65, 0.025);
    if (!client.timeWarningPlayed) {
      playAudio(pick(SOUNDS.timeWarning));
      client.timeWarningPlayed = true;
    }
  }
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
  let answerText = best?.answer || "a suspicious dashboard";
  
  // Handle drawing answers - show descriptive text instead of raw data URLs
  if (String(answerText).startsWith("data:image")) {
    answerText = "a terrible drawing";
  }
  
  return `Tonight, ${winner?.name || "the room"} helped invent ${client.room.theme?.title?.toLowerCase() || "a suspicious business"} and somehow made "${answerText}" sound investable. Analysts predict one apology, two charts, and a mascot with a podcast.`;
}

function copyRecap() {
  const standings = standingsForRoom();
  const text = [
    "Evil Startups recap",
    `Room: ${client.room.code}`,
    `Theme: ${client.room.theme?.title || "Unknown"}`,
    `Winner: ${standings[0]?.name || "Nobody"} (${standings[0]?.score || 0} points)`,
    ...client.room.winners.map((winner) => {
      let answerText = winner.answer;
      if (String(answerText).startsWith("data:image")) {
        answerText = "a terrible drawing";
      }
      return `${winner.playerName} won ${winner.round} with "${answerText}".`;
    }),
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
    leaderboard: "Scores are in. Look at the host screen.",
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

function playAudio(filename, volume = 1) {
  if (!client.sound) return null;

  try {
    // Stop any currently playing audio to prevent overlaps
    if (client.currentAudio) {
      client.currentAudio.pause();
      client.currentAudio.currentTime = 0;
    }
    
    const audio = new Audio(`assets/audio/${filename}`);
    audio.volume = volume;
    client.currentAudio = audio;
    audio.play().catch((error) => {
      console.warn("Audio play blocked:", error);
    });
    return audio;
  } catch (error) {
    console.warn("Audio load failed:", error);
    return null;
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