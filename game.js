const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const statusEl = document.getElementById("status");
const topScoreEl = document.getElementById("top-score");
const topJumpsEl = document.getElementById("top-jumps");
const invincibleTimerEl = document.getElementById("invincible-timer");
const musicIndicatorEl = document.getElementById("music-indicator");
const accountNameEl = document.getElementById("account-name");
const accountSaveEl = document.getElementById("account-save");
const activeAccountEl = document.getElementById("active-account");
const accountBestEl = document.getElementById("account-best");
const runSummaryEl = document.getElementById("run-summary");
const runSummaryMetaEl = document.getElementById("run-summary-meta");
const runLeaderboardListEl = document.getElementById("run-leaderboard-list");

const JUMP_BUFFER_MS = 120;
const BIOME_SWITCH_SCORE = 5000;
const BIOME_BEACH_SCORE = 10000;
const BIOME_STORM_SCORE = 15000;
const BIOME_CLIFF_SCORE = 20000;
const INVINCIBILITY_DURATION_MS = 5000;
const FLOAT_DURATION_MS = 1200;
const SAFE_POCKET_CYCLE_MS = 7600;
const SAFE_POCKET_START_MS = 4700;
const SAFE_POCKET_END_MS = 6200;
const MUSIC_BASE_VOLUME = 0.11;
const LOSE_SOUND_OFFSET_SEC = 0.09;
const GAME_PACE_MULTIPLIER = 1.75;
const HUNTER_OBSTACLE_MIN_GAP = 220;
const HUNTER_HUNTER_MIN_GAP = 150;
const ACCOUNT_STORAGE_KEY = "dino_dodger_accounts_v1";
const ACTIVE_ACCOUNT_KEY = "dino_dodger_active_account_v1";
const RUN_LEADERBOARD_KEY = "dino_dodger_score_leaderboard_v2";
const MAX_RUN_LEADERBOARD = 5;
const GLOBAL_LEADERBOARD_COLLECTION = "leaderboard_scores";

const world = {
  w: canvas.width,
  h: canvas.height,
  groundY: canvas.height - 70,
  gravity: 0.92,
  speed: 3.8,
  baseSpeed: 3.8,
  maxSpeed: 9.4,
  score: 0,
  playing: true,
  slowTimer: 0,
  biome: "night",
  invincibleTimer: 0,
  stormInvincibilityUsed: false,
};

const player = {
  x: 120,
  y: world.groundY - 46,
  w: 38,
  h: 46,
  vy: 0,
  jumpPower: 15.4,
  onGround: true,
  frame: 0,
  doubleJumpCharges: 0,
  floatTimer: 0,
};

const obstacles = [];
const hunters = [];
const flyers = [];
const eggs = [];
const powerUps = [];
const rockShards = [];
const rogueWaves = [];
let dust = [];
let lastSpawn = 0;
let lastHunterSpawn = 0;
let lastFlyerSpawn = 0;
let lastPowerupSpawn = 0;
let lastRockSpawn = 0;
let lastWaveSpawn = 0;
let gameTime = 0;
let jumpBufferTimer = 0;
let firstHunterSpawned = false;
let awaitingFirstStart = true;
let accounts = {};
let activeAccount = "Guest";
let runLeaderboard = [];
let db = null;
let globalLeaderboardReady = false;

let audioCtx;
let musicStarted = false;
let musicMasterGain;
let musicStepInterval = null;
let musicMuted = false;
let loseSound = null;
let loseSoundBuffer = null;
let loseSoundBufferLoading = false;

try {
  loseSound = new Audio("lose-fart.mp3");
  loseSound.preload = "auto";
  loseSound.volume = 0.9;
  loseSound.load();
} catch {
  loseSound = null;
}

function cleanAccountName(name) {
  const cleaned = String(name || "").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 16);
}

function loadAccounts() {
  try {
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveAccounts() {
  try {
    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(accounts));
  } catch {
    // Ignore storage errors and continue gameplay.
  }
}

function loadActiveAccount() {
  try {
    return cleanAccountName(localStorage.getItem(ACTIVE_ACCOUNT_KEY)) || "Guest";
  } catch {
    return "Guest";
  }
}

function saveActiveAccount() {
  try {
    localStorage.setItem(ACTIVE_ACCOUNT_KEY, activeAccount);
  } catch {
    // Ignore storage errors and continue gameplay.
  }
}

function loadRunLeaderboard() {
  try {
    const raw = localStorage.getItem(RUN_LEADERBOARD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        name: cleanAccountName(entry.name) || "Guest",
        score: Math.max(0, Math.floor(Number(entry.score) || 0)),
        at: Number(entry.at) || Date.now(),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RUN_LEADERBOARD);
  } catch {
    return [];
  }
}

function saveRunLeaderboard() {
  try {
    localStorage.setItem(RUN_LEADERBOARD_KEY, JSON.stringify(runLeaderboard));
  } catch {
    // Ignore storage errors and continue gameplay.
  }
}

function initGlobalLeaderboard() {
  try {
    if (!window.firebase || !window.DINOVEER_FIREBASE_CONFIG) {
      return;
    }

    if (!window.firebase.apps || window.firebase.apps.length === 0) {
      window.firebase.initializeApp(window.DINOVEER_FIREBASE_CONFIG);
    }

    db = window.firebase.firestore();
    globalLeaderboardReady = true;
  } catch {
    globalLeaderboardReady = false;
    db = null;
  }
}

async function fetchGlobalLeaderboard() {
  if (!globalLeaderboardReady || !db) return false;

  try {
    const snapshot = await db
      .collection(GLOBAL_LEADERBOARD_COLLECTION)
      .orderBy("score", "desc")
      .limit(MAX_RUN_LEADERBOARD)
      .get();

    const globalTop = snapshot.docs
      .map((doc) => doc.data())
      .map((entry) => ({
        name: cleanAccountName(entry.name) || "Guest",
        score: Math.max(0, Math.floor(Number(entry.score) || 0)),
        at: Number(entry.at) || Date.now(),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RUN_LEADERBOARD);

    if (globalTop.length > 0) {
      runLeaderboard = globalTop;
      renderRunLeaderboard();
    }

    return true;
  } catch {
    return false;
  }
}

async function submitGlobalScore(name, score) {
  if (!globalLeaderboardReady || !db || score <= 0) return;

  try {
    await db.collection(GLOBAL_LEADERBOARD_COLLECTION).add({
      name: cleanAccountName(name) || "Guest",
      score: Math.floor(score),
      at: Date.now(),
    });
  } catch {
    // Keep local leaderboard active if remote write fails.
  }
}

function ensureAccount(name) {
  const accountName = cleanAccountName(name) || "Guest";
  if (!accounts[accountName]) {
    accounts[accountName] = {
      bestScore: 0,
      runs: 0,
      updatedAt: Date.now(),
    };
  } else {
    const existing = accounts[accountName];
    existing.bestScore = Math.max(0, Math.floor(Number(existing.bestScore) || 0));
    existing.runs = Math.max(0, Math.floor(Number(existing.runs) || 0));
    existing.updatedAt = Number(existing.updatedAt) || Date.now();
  }
  return accountName;
}

function renderActiveAccountMeta() {
  if (activeAccountEl) {
    activeAccountEl.textContent = `Active: ${activeAccount}`;
  }
  if (accountBestEl) {
    const account = accounts[activeAccount] || { bestScore: 0 };
    accountBestEl.textContent = `Best: ${account.bestScore}`;
  }
}

function setActiveAccount(name) {
  activeAccount = ensureAccount(name);
  if (accountNameEl) accountNameEl.value = activeAccount;
  renderActiveAccountMeta();
  saveAccounts();
  saveActiveAccount();
}

function renderRunLeaderboard() {
  if (!runLeaderboardListEl) return;
  runLeaderboardListEl.innerHTML = "";

  const top = runLeaderboard.slice(0, MAX_RUN_LEADERBOARD);
  if (top.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No runs yet";
    runLeaderboardListEl.appendChild(li);
    return;
  }

  for (const entry of top) {
    const li = document.createElement("li");
    li.textContent = `${entry.name} - ${entry.score} pts`;
    runLeaderboardListEl.appendChild(li);
  }
}

function showRunSummary(lastScore) {
  if (!runSummaryEl || !runSummaryMetaEl) return;
  const account = accounts[activeAccount] || {
    bestScore: 0,
    runs: 0,
  };
  runSummaryMetaEl.textContent = `Account: ${activeAccount} | Score: ${lastScore} | Best Score: ${account.bestScore} | Runs: ${account.runs}`;
  renderRunLeaderboard();
  runSummaryEl.classList.remove("hidden");
}

function hideRunSummary() {
  if (!runSummaryEl) return;
  runSummaryEl.classList.add("hidden");
}

function recordRun(score) {
  if (score <= 0) return;

  const accountName = ensureAccount(activeAccount);
  const account = accounts[accountName];
  account.runs += 1;
  account.bestScore = Math.max(account.bestScore, score);
  account.updatedAt = Date.now();

  if (accountName === activeAccount) {
    renderActiveAccountMeta();
  }

  runLeaderboard.push({
    name: accountName,
    score,
    at: Date.now(),
  });
  runLeaderboard.sort((a, b) => b.score - a.score);
  runLeaderboard = runLeaderboard.slice(0, MAX_RUN_LEADERBOARD);

  saveAccounts();
  saveRunLeaderboard();

  submitGlobalScore(accountName, score)
    .then(() => fetchGlobalLeaderboard())
    .catch(() => {
      // Local leaderboard already updated.
    });
}

function attachAccountEvents() {
  if (accountNameEl) {
    accountNameEl.addEventListener("keydown", (e) => {
      e.stopPropagation();
    });
  }

  if (accountSaveEl) {
    accountSaveEl.addEventListener("click", () => {
      const entered = cleanAccountName(accountNameEl ? accountNameEl.value : "");
      setActiveAccount(entered || "Guest");
      statusEl.textContent = `Account set: ${activeAccount}`;
      renderRunLeaderboard();
    });
  }

  if (accountNameEl) {
    accountNameEl.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const entered = cleanAccountName(accountNameEl.value);
      setActiveAccount(entered || "Guest");
      statusEl.textContent = `Account set: ${activeAccount}`;
      renderRunLeaderboard();
    });
  }
}

function updateHud() {
  const shownScore = Math.floor(world.score);
  scoreEl.textContent = `Score: ${shownScore}`;
  topScoreEl.textContent = `Score: ${shownScore}`;
  topJumpsEl.textContent = `Double Jumps: ${player.doubleJumpCharges}`;
}

function updateInvincibilityCountdown() {
  if (world.invincibleTimer > 0) {
    const secondsLeft = Math.ceil(world.invincibleTimer / 1000);
    invincibleTimerEl.textContent = `Invincible: ${secondsLeft}s`;
    invincibleTimerEl.classList.remove("hidden");
  } else {
    invincibleTimerEl.classList.add("hidden");
  }
}


function musicNote(type, freq, durationSec, gain, destination, endFreq = null) {
  if (!audioCtx || !destination) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (endFreq !== null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), now + durationSec);
  }

  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.exponentialRampToValueAtTime(gain, now + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

  osc.connect(amp);
  amp.connect(destination);
  osc.start(now);
  osc.stop(now + durationSec + 0.03);
}

function musicKick(destination) {
  musicNote("sine", 140, 0.16, 0.15, destination, 45);
}

function musicHat(destination) {
  musicNote("square", 3200, 0.03, 0.03, destination, 1200);
}

function updateMusicIndicator() {
  if (!musicIndicatorEl) return;
  if (musicMuted) {
    musicIndicatorEl.src = "music-off.png";
    musicIndicatorEl.alt = "Music muted (press M to unmute)";
    musicIndicatorEl.title = "Music muted (M)";
  } else {
    musicIndicatorEl.src = "music-on.png";
    musicIndicatorEl.alt = "Music on (press M to mute)";
    musicIndicatorEl.title = "Music on (M)";
  }
}

function applyMusicMuteState() {
  if (!audioCtx || !musicMasterGain) return;
  const now = audioCtx.currentTime;
  const target = musicMuted ? 0.00001 : MUSIC_BASE_VOLUME;
  musicMasterGain.gain.cancelScheduledValues(now);
  musicMasterGain.gain.exponentialRampToValueAtTime(target, now + 0.05);
}

function toggleMusicMute() {
  ensureAudio();
  musicMuted = !musicMuted;
  applyMusicMuteState();
  updateMusicIndicator();
  statusEl.textContent = musicMuted ? "Music muted" : "Music unmuted";
}

function startGameMusic() {
  if (!audioCtx || musicStarted) return;

  musicMasterGain = audioCtx.createGain();
  musicMasterGain.gain.value = MUSIC_BASE_VOLUME;
  musicMasterGain.connect(audioCtx.destination);

  const grooveFilter = audioCtx.createBiquadFilter();
  grooveFilter.type = "lowpass";
  grooveFilter.frequency.value = 2100;
  grooveFilter.Q.value = 1.1;
  grooveFilter.connect(musicMasterGain);

  const bassPattern = [55.0, 55.0, 61.74, 55.0, 73.42, 61.74, 55.0, 49.0];
  const leadPattern = [
    null, 440.0, 523.25, 587.33, 659.25, 587.33, 523.25, 440.0,
    null, 392.0, 523.25, 659.25, 783.99, 659.25, 523.25, 440.0,
  ];

  let step = 0;
  const runStep = () => {
    const bassFreq = bassPattern[step % bassPattern.length];
    musicNote("sawtooth", bassFreq, 0.22, 0.07, grooveFilter, bassFreq * 0.94);

    if (step % 2 === 0) {
      musicKick(grooveFilter);
    } else {
      musicHat(grooveFilter);
    }

    const leadFreq = leadPattern[step % leadPattern.length];
    if (leadFreq) {
      musicNote("square", leadFreq, 0.11, 0.04, grooveFilter, leadFreq * 1.03);
    }

    if (step % 8 === 6) {
      musicNote("triangle", 330, 0.14, 0.03, grooveFilter, 220);
    }

    step += 1;
  };

  runStep();
  musicStepInterval = setInterval(runStep, 125);
  musicStarted = true;
  applyMusicMuteState();
}

function primeLoseSoundBuffer() {
  if (!audioCtx || loseSoundBuffer || loseSoundBufferLoading) return;

  loseSoundBufferLoading = true;
  fetch("lose-fart.mp3")
    .then((res) => {
      if (!res.ok) throw new Error("Failed to load lose sound");
      return res.arrayBuffer();
    })
    .then((bytes) => audioCtx.decodeAudioData(bytes))
    .then((decoded) => {
      loseSoundBuffer = decoded;
    })
    .catch(() => {
      // Keep HTMLAudio fallback path if decode fails.
    })
    .finally(() => {
      loseSoundBufferLoading = false;
    });
}

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {
      // Browser can block resume until a direct gesture; queueJump retries.
    });
  }
  startGameMusic();
  primeLoseSoundBuffer();
}

function tone(type, freq, durationSec, gain = 0.05, endFreq = null) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (endFreq !== null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), now + durationSec);
  }

  amp.gain.setValueAtTime(0.001, now);
  amp.gain.exponentialRampToValueAtTime(gain, now + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

  osc.connect(amp);
  amp.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + durationSec + 0.02);
}

function playJump() {
  tone("sine", 1180, 0.08, 0.05, 1520);
  tone("triangle", 1480, 0.06, 0.03, 1780);
}

function playDoubleJump() {
  tone("triangle", 350, 0.12, 0.05, 760);
}

function playPickup() {
  tone("triangle", 360, 0.13, 0.055, 220);
  tone("sine", 270, 0.11, 0.04, 560);
  tone("triangle", 560, 0.12, 0.03, 760);
}

function playEggDrop() {
  tone("sine", 220, 0.07, 0.03, 160);
}

function playSlowHit() {
  tone("sawtooth", 180, 0.14, 0.045, 110);
}

function playCrashFallback() {
  tone("sawtooth", 180, 0.18, 0.06, 62);
  tone("triangle", 120, 0.14, 0.05, 48);
  tone("square", 90, 0.08, 0.025, 70);
}

function playCrash() {
  if (audioCtx && loseSoundBuffer) {
    const src = audioCtx.createBufferSource();
    const gain = audioCtx.createGain();
    gain.gain.value = 1.0;
    src.buffer = loseSoundBuffer;
    src.connect(gain);
    gain.connect(audioCtx.destination);
    const offset = Math.min(LOSE_SOUND_OFFSET_SEC, Math.max(0, loseSoundBuffer.duration - 0.02));
    src.start(0, offset);
    return;
  }

  if (!loseSound) {
    playCrashFallback();
    return;
  }

  loseSound.currentTime = LOSE_SOUND_OFFSET_SEC;
  const playPromise = loseSound.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {
      playCrashFallback();
    });
  }
}

function playStompDing() {
  tone("sine", 980, 0.08, 0.05, 1280);
  tone("triangle", 1320, 0.06, 0.03, 1620);
}

function endRun(message, playFailSound = true) {
  if (!world.playing) return;

  world.playing = false;
  const finalScore = Math.floor(world.score);
  if (playFailSound) {
    playCrash();
  }
  statusEl.textContent = `${message} - tap/press jump to restart`;
  recordRun(finalScore);
  showRunSummary(finalScore);
}

function reset(startPaused = false) {
  world.score = 0;
  world.speed = world.baseSpeed;
  world.playing = !startPaused;
  world.slowTimer = 0;
  world.invincibleTimer = 0;
  world.stormInvincibilityUsed = false;

  player.y = world.groundY - player.h;
  player.vy = 0;
  player.onGround = true;
  player.doubleJumpCharges = 0;
  player.floatTimer = 0;

  obstacles.length = 0;
  hunters.length = 0;
  flyers.length = 0;
  eggs.length = 0;
  powerUps.length = 0;
  rockShards.length = 0;
  rogueWaves.length = 0;
  dust = [];

  gameTime = 0;
  jumpBufferTimer = 0;
  lastSpawn = 0;
  lastHunterSpawn = 0;
  lastFlyerSpawn = 0;
  lastPowerupSpawn = 0;
  lastRockSpawn = 0;
  lastWaveSpawn = 0;
  firstHunterSpawned = false;
  world.biome = "night";
  awaitingFirstStart = startPaused;
  statusEl.textContent = startPaused ? "Press jump to start" : "Running";
  hideRunSummary();
  updateHud();
  updateInvincibilityCountdown();
}

function attemptJump() {
  if (player.onGround) {
    player.vy = -player.jumpPower;
    player.onGround = false;
    jumpBufferTimer = 0;
    playJump();
    return true;
  }

  if (player.doubleJumpCharges > 0) {
    player.doubleJumpCharges -= 1;
    player.vy = -player.jumpPower * 0.95;
    jumpBufferTimer = 0;
    playDoubleJump();
    return true;
  }

  return false;
}

function queueJump() {
  ensureAudio();

  if (!world.playing) {
    reset(false);
    return;
  }

  jumpBufferTimer = JUMP_BUFFER_MS;
  attemptJump();
}

window.addEventListener("keydown", (e) => {
  const target = e.target;
  const isTypingField = target && (
    target.tagName === "INPUT"
    || target.tagName === "TEXTAREA"
    || target.isContentEditable
  );
  if (isTypingField) {
    return;
  }

  if (e.code === "KeyM" && !e.repeat) {
    e.preventDefault();
    toggleMusicMute();
    return;
  }

  if (["Space", "ArrowUp", "KeyW"].includes(e.code)) {
    e.preventDefault();
    queueJump();
  }
});

window.addEventListener("pointerdown", (e) => {
  if (e.target !== canvas) {
    return;
  }
  queueJump();
});

function spawnObstacle() {
  const tall = Math.random() > 0.5;
  obstacles.push({
    x: world.w + 30,
    y: world.groundY - (tall ? 58 : 42),
    w: tall ? 28 : 22,
    h: tall ? 58 : 42,
    passed: false,
  });
}

function spawnHunter(firstSpawn = false) {
  const hunterSpeedMult = firstSpawn ? 0.84 : 1.07;
  const baseX = world.w + (firstSpawn ? 190 : 40);
  const minXFromObstacles = obstacles.reduce((maxX, o) => {
    if (o.crushed) return maxX;
    return Math.max(maxX, o.x + o.w + HUNTER_OBSTACLE_MIN_GAP);
  }, baseX);
  const minXFromHunters = hunters.reduce((maxX, h) => {
    if (h.stomped) return maxX;
    return Math.max(maxX, h.x + h.w + HUNTER_HUNTER_MIN_GAP);
  }, baseX);
  const spawnX = Math.max(baseX, minXFromObstacles, minXFromHunters);

  hunters.push({
    x: spawnX,
    y: world.groundY - 40,
    w: 48,
    h: 40,
    legTick: Math.random() * 12,
    speedMult: hunterSpeedMult,
    passed: false,
  });
}

function spawnFlyer() {
  flyers.push({
    x: world.w + 50,
    y: 42 + Math.random() * 44,
    w: 44,
    h: 30,
    bob: Math.random() * 10,
    dropped: false,
    dropCooldown: 0,
  });
}

function spawnPowerUp() {
  powerUps.push({
    x: world.w + 40,
    y: world.groundY - 118,
    w: 24,
    h: 24,
    bob: Math.random() * 10,
  });
}

function spawnRockShard() {
  const targetX = player.x + 70 + Math.random() * 250;
  rockShards.push({
    x: targetX,
    y: -40 - Math.random() * 60,
    targetX,
    w: 15,
    h: 22,
    vy: 0,
    warningTimer: 480,
  });
}

function spawnRogueWave() {
  rogueWaves.push({
    x: world.w + 40,
    y: world.groundY - 24,
    w: 90 + Math.random() * 70,
    h: 26,
    surge: Math.random() * 8,
  });
}

function inSafePocket() {
  if (world.biome !== "cliffs") return false;
  const phase = gameTime % SAFE_POCKET_CYCLE_MS;
  return phase >= SAFE_POCKET_START_MS && phase <= SAFE_POCKET_END_MS;
}

function rectHit(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function addDust() {
  if (!player.onGround || !world.playing) return;
  if (Math.random() < 0.36) {
    dust.push({
      x: player.x + 8,
      y: world.groundY - 2,
      r: 2 + Math.random() * 2,
      life: 24,
    });
  }
}

function currentTargetSpeed() {
  const progress = Math.log1p(world.score / 240);
  return Math.min(world.maxSpeed, world.baseSpeed + progress * 1.8);
}

function update(dt) {
  gameTime += dt;
  jumpBufferTimer = Math.max(0, jumpBufferTimer - dt);
  const frameScale = (dt / 16.6667) * GAME_PACE_MULTIPLIER;

  if (!world.playing) {
    return;
  }

  const safePocket = inSafePocket();
  const slowFactor = world.slowTimer > 0 ? 0.74 : 1;
  const desired = currentTargetSpeed() * slowFactor;
  world.speed += (desired - world.speed) * Math.min(1, dt * 0.0035);

  world.score += world.speed * 0.3 * frameScale;
  if (world.slowTimer > 0) {
    world.slowTimer = Math.max(0, world.slowTimer - dt);
  }
  if (world.invincibleTimer > 0) {
    world.invincibleTimer = Math.max(0, world.invincibleTimer - dt);
  }
  if (player.floatTimer > 0) {
    player.floatTimer = Math.max(0, player.floatTimer - dt);
  }

  if (world.biome === "night" && world.score >= BIOME_SWITCH_SCORE) {
    world.biome = "sandfire";
    statusEl.textContent = "Scorched Sands";
  }

  if (world.biome === "sandfire" && world.score >= BIOME_BEACH_SCORE) {
    world.biome = "beach";
    statusEl.textContent = "Moonlit Beach";
  }

  if (world.biome === "beach" && world.score >= BIOME_STORM_SCORE) {
    world.biome = "storm";
    statusEl.textContent = "Stormy Coast";

    if (!world.stormInvincibilityUsed) {
      world.invincibleTimer = INVINCIBILITY_DURATION_MS;
      world.stormInvincibilityUsed = true;
    }
  }

  if (world.biome === "storm" && world.score >= BIOME_CLIFF_SCORE) {
    world.biome = "cliffs";
    statusEl.textContent = "Thunder Cliffs";
  }

  let gravityScale = 1;
  if (player.floatTimer > 0) {
    gravityScale = 0.34;
    player.vy -= 0.17 * frameScale;
  }

  player.vy += world.gravity * gravityScale * frameScale;
  player.y += player.vy * frameScale;

  if (world.biome === "cliffs") {
    const centerY = player.y + player.h * 0.5;
    const lane = centerY < world.groundY - 120 ? -1 : centerY < world.groundY - 70 ? 1 : -1;
    const pulse = Math.sin(gameTime * 0.0024) > 0 ? 1 : -1;
    const gustBase = lane * pulse * 0.22;
    const gust = safePocket ? gustBase * 0.3 : gustBase;
    player.x += gust * frameScale;
  }

  player.x = Math.max(70, Math.min(world.w * 0.45, player.x));

  if (player.y >= world.groundY - player.h) {
    player.y = world.groundY - player.h;
    player.vy = 0;
    player.onGround = true;
  }

  if (jumpBufferTimer > 0 && player.onGround) {
    attemptJump();
  }

  addDust();

  if (gameTime - lastSpawn > 1200 + Math.random() * 900) {
    spawnObstacle();
    lastSpawn = gameTime;
  }

  const hunterGraceScore = 1100;
  const hunterInterval = firstHunterSpawned
    ? 3600 + Math.random() * 2200
    : 6200 + Math.random() * 1800;
  if (world.score >= hunterGraceScore && gameTime - lastHunterSpawn > hunterInterval) {
    spawnHunter(!firstHunterSpawned);
    firstHunterSpawned = true;
    lastHunterSpawn = gameTime;
  }

  if (gameTime - lastFlyerSpawn > 5200 + Math.random() * 3200) {
    spawnFlyer();
    lastFlyerSpawn = gameTime;
  }

  if (gameTime - lastPowerupSpawn > 7000 + Math.random() * 5000) {
    spawnPowerUp();
    lastPowerupSpawn = gameTime;
  }

  if (world.biome === "cliffs") {
    if (!safePocket && gameTime - lastRockSpawn > 900 + Math.random() * 900) {
      spawnRockShard();
      lastRockSpawn = gameTime;
    }
    if (gameTime - lastWaveSpawn > 3200 + Math.random() * 2600) {
      spawnRogueWave();
      lastWaveSpawn = gameTime;
    }
  }

  for (const o of obstacles) {
    o.x -= world.speed * frameScale;
    if (!o.passed && o.x + o.w < player.x) {
      o.passed = true;
      world.score += 35;
    }
    if (world.playing && rectHit(player, o)) {
      if (world.invincibleTimer > 0 && player.onGround) {
        o.crushed = true;
        world.score += 25;
        playStompDing();
      } else {
        playCrash();
        endRun("Crashed", false);
      }
    }
  }

  for (const h of hunters) {
    h.x -= world.speed * h.speedMult * frameScale;
    h.legTick += world.speed * 0.2 * frameScale;
    if (!h.passed && h.x + h.w < player.x) {
      h.passed = true;
      world.score += 50;
    }

    if (world.playing && rectHit(player, h)) {
      const playerBottom = player.y + player.h;
      const stompedFromAbove = player.vy > 0 && playerBottom <= h.y + 18;

      if ((world.invincibleTimer > 0 && player.onGround) || stompedFromAbove) {
        h.stomped = true;
        if (stompedFromAbove) {
          player.vy = -player.jumpPower * 0.52;
          player.onGround = false;
        }
        world.score += 85;
        playStompDing();
      } else {
        endRun("Caught");
      }
    }
  }

  for (const f of flyers) {
    f.x -= world.speed * 0.9 * frameScale;
    f.bob += 0.08 * frameScale;
    f.dropCooldown += dt;

    if (!f.dropped && f.dropCooldown > 900 && f.x < player.x + 150) {
      const startX = f.x + 14;
      const isAccurateDrop = Math.random() < 0.65;
      const missOffset = isAccurateDrop
        ? (Math.random() - 0.5) * 16
        : (Math.random() < 0.5 ? -1 : 1) * (26 + Math.random() * 24);

      eggs.push({
        x: startX,
        y: f.y + Math.sin(f.bob) * 8 + 24,
        w: 14,
        h: 18,
        vy: 1.8,
        targetX: player.x + player.w * 0.5 + missOffset,
      });
      f.dropped = true;
      playEggDrop();
    }
  }

  for (const e of eggs) {
    const xAdjust = Math.max(-0.9, Math.min(0.9, (e.targetX - e.x) * 0.025));
    e.x += xAdjust * frameScale - world.speed * 0.58 * frameScale;
    e.vy += 0.45 * frameScale;
    e.y += e.vy * frameScale;

    if (rectHit(player, e)) {
      world.slowTimer = 2100;
      e.hit = true;
      playSlowHit();
      statusEl.textContent = "Slowed by egg!";
    }

    if (e.y + e.h >= world.groundY) {
      e.broken = true;
    }
  }

  for (const p of powerUps) {
    p.x -= world.speed * frameScale;
    p.bob += 0.07 * frameScale;
    if (rectHit(player, p)) {
      player.doubleJumpCharges += 1;
      p.collected = true;
      playPickup();
      statusEl.textContent = "Double Jump ready";
    }
  }

  for (const shard of rockShards) {
    shard.x -= world.speed * 0.24 * frameScale;
    if (shard.warningTimer > 0) {
      shard.warningTimer -= dt;
      continue;
    }

    shard.vy += 0.5 * frameScale;
    shard.y += shard.vy * frameScale;

    if (rectHit(player, shard)) {
      if (world.invincibleTimer > 0 && player.onGround) {
        shard.broken = true;
        world.score += 40;
        playStompDing();
      } else {
        endRun("Shattered");
      }
    }

    if (shard.y + shard.h >= world.groundY) {
      shard.broken = true;
    }
  }

  for (const wave of rogueWaves) {
    wave.x -= world.speed * 1.18 * frameScale;
    wave.surge += 0.08 * frameScale;

    const waveHit = {
      x: wave.x,
      y: wave.y - 6,
      w: wave.w,
      h: wave.h + 10,
    };

    if (rectHit(player, waveHit)) {
      player.floatTimer = FLOAT_DURATION_MS;
    }
  }

  for (let i = obstacles.length - 1; i >= 0; i -= 1) {
    if (obstacles[i].x < -80 || obstacles[i].crushed) {
      obstacles.splice(i, 1);
    }
  }

  for (let i = hunters.length - 1; i >= 0; i -= 1) {
    if (hunters[i].x < -80 || hunters[i].stomped) {
      hunters.splice(i, 1);
    }
  }

  for (let i = flyers.length - 1; i >= 0; i -= 1) {
    if (flyers[i].x < -80) {
      flyers.splice(i, 1);
    }
  }

  for (let i = eggs.length - 1; i >= 0; i -= 1) {
    if (eggs[i].x < -60 || eggs[i].hit || eggs[i].broken) {
      eggs.splice(i, 1);
    }
  }

  for (let i = powerUps.length - 1; i >= 0; i -= 1) {
    if (powerUps[i].x < -60 || powerUps[i].collected) {
      powerUps.splice(i, 1);
    }
  }

  for (let i = rockShards.length - 1; i >= 0; i -= 1) {
    if (rockShards[i].x < -80 || rockShards[i].broken) {
      rockShards.splice(i, 1);
    }
  }

  for (let i = rogueWaves.length - 1; i >= 0; i -= 1) {
    if (rogueWaves[i].x + rogueWaves[i].w < -80) {
      rogueWaves.splice(i, 1);
    }
  }

  for (const p of dust) {
    p.x -= world.speed * 0.8 * frameScale;
    p.life -= frameScale;
    p.r *= Math.pow(0.98, frameScale);
  }
  dust = dust.filter((p) => p.life > 0 && p.r > 0.4);

  player.frame += frameScale;

  if (world.playing) {
    if (world.invincibleTimer > 0) {
      statusEl.textContent = "Invincible Rampage";
    } else if (world.slowTimer <= 0) {
      if (world.biome === "cliffs") {
        if (safePocket) {
          statusEl.textContent = player.doubleJumpCharges > 0 ? "Thunder Cliffs Safe Pocket + Double Jump" : "Thunder Cliffs Safe Pocket";
        } else {
          statusEl.textContent = player.doubleJumpCharges > 0 ? "Thunder Cliffs + Double Jump" : "Thunder Cliffs";
        }
      } else if (world.biome === "sandfire") {
        statusEl.textContent = player.doubleJumpCharges > 0 ? "Scorched Sands + Double Jump" : "Scorched Sands";
      } else if (world.biome === "beach") {
        statusEl.textContent = player.doubleJumpCharges > 0 ? "Moonlit Beach + Double Jump" : "Moonlit Beach";
      } else if (world.biome === "storm") {
        statusEl.textContent = player.doubleJumpCharges > 0 ? "Stormy Coast + Double Jump" : "Stormy Coast";
      } else {
        statusEl.textContent = player.doubleJumpCharges > 0 ? "Running + Double Jump" : "Running";
      }
    }
  }

  updateHud();
  updateInvincibilityCountdown();
}

function drawBackground() {
  if (world.biome === "cliffs") {
    const cliffGrad = ctx.createLinearGradient(0, 0, 0, world.groundY);
    cliffGrad.addColorStop(0, "#08172d");
    cliffGrad.addColorStop(0.54, "#1f4269");
    cliffGrad.addColorStop(1, "#4e7893");
    ctx.fillStyle = cliffGrad;
    ctx.fillRect(0, 0, world.w, world.groundY);

    ctx.fillStyle = "rgba(178, 211, 232, 0.24)";
    for (let i = 0; i < 10; i += 1) {
      const x = (i * 150 - (gameTime * 0.14) % 150) - 20;
      const y = 24 + (i % 4) * 18;
      ctx.fillRect(x, y, 38, 3);
    }

    ctx.fillStyle = "#274a61";
    ctx.beginPath();
    ctx.moveTo(0, world.groundY - 44);
    for (let x = 0; x <= world.w + 40; x += 40) {
      const ridgeY = world.groundY - 70 - Math.sin((x + gameTime * 0.02) * 0.02) * 10;
      ctx.lineTo(x, ridgeY);
    }
    ctx.lineTo(world.w, world.groundY - 26);
    ctx.lineTo(0, world.groundY - 26);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#235a80";
    ctx.fillRect(0, world.groundY - 24, world.w, 24);
    ctx.fillStyle = "rgba(217, 242, 255, 0.55)";
    ctx.fillRect(0, world.groundY - 24, world.w, 3);

    ctx.fillStyle = "#6d7b85";
    ctx.fillRect(0, world.groundY, world.w, world.h - world.groundY);

    if (inSafePocket()) {
      ctx.fillStyle = "rgba(165, 228, 255, 0.16)";
      ctx.fillRect(0, 0, world.w, world.groundY);
    }
    return;
  }

  if (world.biome === "storm") {
    const stormGrad = ctx.createLinearGradient(0, 0, 0, world.groundY);
    stormGrad.addColorStop(0, "#0a1f44");
    stormGrad.addColorStop(0.6, "#1e4f87");
    stormGrad.addColorStop(1, "#6ea7cf");
    ctx.fillStyle = stormGrad;
    ctx.fillRect(0, 0, world.w, world.groundY);

    ctx.strokeStyle = "rgba(136, 190, 235, 0.4)";
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 120; i += 1) {
      const x = (i * 23 + (gameTime * 1.6) % 36) % (world.w + 24) - 12;
      const y = (i * 19 + (gameTime * 0.6) % 20) % (world.groundY - 10);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, y + 10);
      ctx.stroke();
    }

    ctx.fillStyle = "#1b5f8f";
    ctx.fillRect(0, world.groundY - 20, world.w, 22);
    ctx.fillStyle = "rgba(213, 237, 255, 0.58)";
    ctx.fillRect(0, world.groundY - 20, world.w, 3);

    ctx.fillStyle = "#6f7a83";
    ctx.fillRect(0, world.groundY, world.w, world.h - world.groundY);
    return;
  }

  if (world.biome === "beach") {
    const skyGrad = ctx.createLinearGradient(0, 0, 0, world.groundY);
    skyGrad.addColorStop(0, "#0d2e66");
    skyGrad.addColorStop(0.58, "#2f78bc");
    skyGrad.addColorStop(1, "#95d4f2");
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, world.w, world.groundY);

    ctx.fillStyle = "#2a78aa";
    ctx.fillRect(0, world.groundY - 18, world.w, 20);

    ctx.fillStyle = "rgba(238, 250, 255, 0.55)";
    ctx.fillRect(0, world.groundY - 18, world.w, 3);

    ctx.fillStyle = "#b79a6d";
    ctx.fillRect(0, world.groundY, world.w, world.h - world.groundY);
    return;
  }

  if (world.biome === "sandfire") {
    ctx.fillStyle = "#16090c";
    ctx.fillRect(0, 0, world.w, world.groundY);

    ctx.fillStyle = "#4a3b2a";
    ctx.fillRect(0, world.groundY, world.w, world.h - world.groundY);
    return;
  }

  const stars = 90;
  ctx.fillStyle = "#06122a";
  ctx.fillRect(0, 0, world.w, world.groundY);

  ctx.fillStyle = "rgba(221, 233, 255, 0.95)";
  for (let i = 0; i < stars; i += 1) {
    const x = (i * 83 + gameTime * 0.01) % world.w;
    const y = ((i * 47) % (world.groundY - 24)) + 8;
    const twinkle = 0.35 + Math.sin(gameTime * 0.002 + i) * 0.25;
    ctx.globalAlpha = Math.max(0.2, twinkle);
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.globalAlpha = 1;

  const moonGrad = ctx.createRadialGradient(122, 54, 4, 130, 62, 26);
  moonGrad.addColorStop(0, "#fcfdff");
  moonGrad.addColorStop(0.55, "#e4e8f1");
  moonGrad.addColorStop(1, "#bcc5d9");
  ctx.fillStyle = moonGrad;
  ctx.beginPath();
  ctx.arc(130, 62, 24, 0, Math.PI * 2);
  ctx.fill();

  const cloudBands = [
    { y: 56, speed: 0.07, w: 112, h: 28, color: "rgba(185, 205, 244, 0.25)" },
    { y: 86, speed: 0.11, w: 86, h: 22, color: "rgba(162, 184, 228, 0.22)" },
  ];

  for (const band of cloudBands) {
    const offset = (gameTime * band.speed) % (world.w + 260);
    for (let i = -1; i < 4; i += 1) {
      const x = i * 290 - offset;
      ctx.fillStyle = band.color;
      ctx.beginPath();
      ctx.ellipse(x + 36, band.y + 1, band.w * 0.26, band.h * 0.68, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 68, band.y - 3, band.w * 0.32, band.h * 0.84, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 100, band.y + 2, band.w * 0.25, band.h * 0.64, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = "#2d3744";
  ctx.fillRect(0, world.groundY, world.w, world.h - world.groundY);
}

function drawRunnerDino(x, y, bodyColor, darkColor, legLift, facing = 1) {
  const dir = facing;

  ctx.fillStyle = bodyColor;
  ctx.fillRect(x + 12, y + 9, 24, 24);
  ctx.fillRect(x + 4, y + 20, 10, 10);
  ctx.fillRect(x + 30, y + 3, 12, 11);
  ctx.fillRect(x + 40, y + 0, 10, 8);

  ctx.fillStyle = darkColor;
  ctx.fillRect(x + 2, y + 22, 8, 6);
  ctx.fillRect(x + 10, y + 34, 7, 12 + legLift);
  ctx.fillRect(x + 23, y + 34, 7, 12 - legLift);
  ctx.fillRect(x + 26, y + 14, 9, 5);

  ctx.fillStyle = "#f6fbff";
  const eyeX = dir === 1 ? x + 43 : x + 34;
  ctx.fillRect(eyeX, y + 3, 3, 3);
}

function drawPlayer() {
  const x = player.x;
  const y = player.y;
  const legLift = player.onGround ? Math.sin(player.frame * 0.3) * 4 : 1;

  if (world.biome === "storm") {
    drawRunnerDino(x, y, "#79d9d1", "#2f7f7a", legLift, 1);
  } else if (world.biome === "beach") {
    drawRunnerDino(x, y, "#2f4b54", "#162a31", legLift, 1);
  } else {
    drawRunnerDino(x, y, "#4fa06e", "#2d5f42", legLift, 1);
  }

  if (player.doubleJumpCharges > 0) {
    ctx.fillStyle = "#ffe28a";
    ctx.fillRect(x + 4, y + 3, 5, 5);
  }

  if (world.invincibleTimer > 0) {
    ctx.strokeStyle = "rgba(209, 249, 255, 0.85)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 6, y + 2, 38, 42);
  }
}

function drawObstacle(o) {
  if (world.biome === "storm") {
    ctx.fillStyle = "#0b121a";
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.fillStyle = "#121e2a";
    ctx.fillRect(o.x + 2, o.y + 5, Math.max(6, o.w - 8), 8);
    ctx.fillStyle = "#05090f";
    ctx.fillRect(o.x + 6, o.y + o.h - 14, Math.max(4, o.w - 12), 8);
    return;
  }

  if (world.biome === "beach") {
    ctx.fillStyle = "#223347";
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.fillStyle = "#334b62";
    ctx.fillRect(o.x + 2, o.y + 6, Math.max(6, o.w - 8), 8);
    ctx.fillStyle = "#172433";
    ctx.fillRect(o.x + 6, o.y + o.h - 14, Math.max(4, o.w - 12), 8);
    return;
  }

  ctx.fillStyle = "#5f7083";
  ctx.fillRect(o.x, o.y, o.w, o.h);
  ctx.fillStyle = "#8699ad";
  ctx.fillRect(o.x + 4, o.y + 10, 4, 8);
  ctx.fillRect(o.x + o.w - 8, o.y + 20, 4, 8);
}

function drawHunter(h) {
  const bounce = Math.abs(Math.sin(h.legTick)) * 3;
  if (world.biome === "beach") {
    drawRunnerDino(h.x - 4, h.y - 3 - bounce, "#3b4e63", "#1f2e3d", Math.sin(h.legTick) * 2, -1);
    return;
  }
  drawRunnerDino(h.x - 4, h.y - 3 - bounce, "#b45e4f", "#7c3d33", Math.sin(h.legTick) * 2, -1);
}

function drawFlyer(f) {
  const y = f.y + Math.sin(f.bob) * 8;

  if (world.biome === "beach") {
    ctx.fillStyle = "#32445d";
    ctx.fillRect(f.x + 8, y + 8, 24, 14);
    ctx.fillRect(f.x + 26, y + 4, 12, 10);
    ctx.fillRect(f.x + 35, y + 6, 9, 6);

    ctx.fillStyle = "#1f2d40";
    ctx.fillRect(f.x, y + 10, 10, 6);
    ctx.fillRect(f.x + 14, y + 22, 8, 5);
    ctx.fillRect(f.x + 26, y + 22, 8, 5);

    ctx.fillStyle = "#99abc8";
    ctx.fillRect(f.x + 31, y + 7, 3, 3);
    return;
  }

  ctx.fillStyle = "#8794cb";
  ctx.fillRect(f.x + 8, y + 8, 24, 14);
  ctx.fillRect(f.x + 26, y + 4, 12, 10);
  ctx.fillRect(f.x + 35, y + 6, 9, 6);

  ctx.fillStyle = "#626fa5";
  ctx.fillRect(f.x, y + 10, 10, 6);
  ctx.fillRect(f.x + 14, y + 22, 8, 5);
  ctx.fillRect(f.x + 26, y + 22, 8, 5);

  ctx.fillStyle = "#dce8ff";
  ctx.fillRect(f.x + 31, y + 7, 3, 3);
}

function drawEgg(e) {
  ctx.fillStyle = "#dae4f7";
  ctx.fillRect(e.x, e.y, e.w, e.h);
  ctx.fillStyle = "#a8b8d9";
  ctx.fillRect(e.x + 4, e.y + 3, 2, 2);
  ctx.fillRect(e.x + 8, e.y + 9, 2, 2);
}

function drawRockShard(shard) {
  if (shard.warningTimer > 0) {
    const alpha = Math.max(0.15, shard.warningTimer / 480);
    ctx.fillStyle = `rgba(255, 194, 108, ${alpha * 0.65})`;
    ctx.fillRect(shard.x - 10, world.groundY - 3, 20, 3);
    return;
  }

  ctx.fillStyle = "#3a4148";
  ctx.fillRect(shard.x, shard.y, shard.w, shard.h);
  ctx.fillStyle = "#616a73";
  ctx.fillRect(shard.x + 3, shard.y + 5, 4, 7);
}

function drawRogueWave(wave) {
  const crest = Math.sin(wave.surge) * 4;
  ctx.fillStyle = "#2a7ca5";
  ctx.fillRect(wave.x, wave.y + crest, wave.w, wave.h);
  ctx.fillStyle = "rgba(211, 242, 255, 0.7)";
  ctx.fillRect(wave.x + 4, wave.y + crest, Math.max(10, wave.w - 8), 3);
}

function drawPowerup(p) {
  const y = p.y + Math.sin(p.bob) * 8;
  ctx.fillStyle = "#ffd050";
  ctx.fillRect(p.x, y, p.w, p.h);
  ctx.fillStyle = "#8a6500";
  ctx.fillRect(p.x + 6, y + 6, 4, 12);
  ctx.fillRect(p.x + 14, y + 6, 4, 12);
}

function drawDust() {
  for (const p of dust) {
    const alpha = Math.max(0, p.life / 24);
    ctx.fillStyle = `rgba(80, 68, 38, ${alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function draw() {
  ctx.clearRect(0, 0, world.w, world.h);
  drawBackground();
  drawDust();

  for (const p of powerUps) drawPowerup(p);
  for (const w of rogueWaves) drawRogueWave(w);
  for (const r of rockShards) drawRockShard(r);
  for (const o of obstacles) drawObstacle(o);
  for (const h of hunters) drawHunter(h);
  for (const f of flyers) drawFlyer(f);
  for (const e of eggs) drawEgg(e);

  drawPlayer();

  if (world.slowTimer > 0 && world.playing) {
    ctx.fillStyle = "rgba(74, 132, 226, 0.2)";
    ctx.fillRect(0, 0, world.w, world.h);
  }

  if (!world.playing) {
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.fillRect(0, 0, world.w, world.h);
    ctx.fillStyle = "#fff";
    if (awaitingFirstStart) {
      ctx.font = "bold 34px Trebuchet MS";
      ctx.fillText("DinoVeer", world.w / 2 - 72, world.h / 2 - 14);
      ctx.font = "20px Trebuchet MS";
      ctx.fillText("Press jump to start", world.w / 2 - 92, world.h / 2 + 20);
    } else {
      ctx.font = "bold 36px Trebuchet MS";
      ctx.fillText("Game Over", world.w / 2 - 105, world.h / 2 - 8);
      ctx.font = "20px Trebuchet MS";
      ctx.fillText("Jump to restart", world.w / 2 - 88, world.h / 2 + 28);
    }
  }
}

let prev = performance.now();
function frame(now) {
  try {
    const dt = Math.min(34, now - prev);
    prev = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    statusEl.textContent = `Runtime error: ${message}`;
  }
}

try {
  accounts = loadAccounts();
  runLeaderboard = loadRunLeaderboard();
  initGlobalLeaderboard();
  attachAccountEvents();
  setActiveAccount(loadActiveAccount());
  renderRunLeaderboard();
  fetchGlobalLeaderboard();

  updateMusicIndicator();
  reset(true);
  requestAnimationFrame(frame);
} catch (err) {
  const message = err && err.message ? err.message : String(err);
  statusEl.textContent = `Init error: ${message}`;
}
