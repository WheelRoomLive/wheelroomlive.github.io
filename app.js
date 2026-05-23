import {
  COLORS,
  DEFAULT_ITEMS,
  ROOM_META,
  chatList,
  cleanName,
  db,
  decryptChatText,
  ensureAnonymousAuth,
  encryptChatText,
  escapeHtml,
  expiryFrom,
  findPlayer,
  firebaseReady,
  formatDate,
  formatTime,
  getRoomJoinId,
  isActiveSpin,
  isExpired,
  makeRoom,
  makeSpin,
  newId,
  normalizeItems,
  now,
  onValue,
  parseRoomJoinId,
  playersList,
  ref,
  remove,
  roomRef,
  runTransaction,
  set,
  settleFinishedTarget,
  update,
  visibleSpinHistory
} from "./shared.js";

const state = {
  mode: "create",
  room: null,
  role: null,
  player: null,
  authUser: null,
  unsubscribeRoom: null,
  currentRotation: 0,
  spinTimer: null,
  activeSpinId: null,
  localSpinEndsAt: 0,
  chatRenderVersion: 0
};

const els = {
  setupPanel: document.querySelector("#setupPanel"),
  gamePanel: document.querySelector("#gamePanel"),
  createMode: document.querySelector("#createMode"),
  joinMode: document.querySelector("#joinMode"),
  playerName: document.querySelector("#playerName"),
  roomIdField: document.querySelector("#roomIdField"),
  roomIdInput: document.querySelector("#roomIdInput"),
  startButton: document.querySelector("#startButton"),
  setupStatus: document.querySelector("#setupStatus"),
  roomCode: document.querySelector("#roomCode"),
  copyRoom: document.querySelector("#copyRoom"),
  expiryText: document.querySelector("#expiryText"),
  players: document.querySelector("#players"),
  hostTools: document.querySelector("#hostTools"),
  guestNotice: document.querySelector("#guestNotice"),
  itemsInput: document.querySelector("#itemsInput"),
  saveItems: document.querySelector("#saveItems"),
  releaseWheel: document.querySelector("#releaseWheel"),
  wheelCanvas: document.querySelector("#wheelCanvas"),
  hubText: document.querySelector("#hubText"),
  spinMeta: document.querySelector("#spinMeta"),
  resultText: document.querySelector("#resultText"),
  spinButton: document.querySelector("#spinButton"),
  spinHistory: document.querySelector("#spinHistory"),
  chatLog: document.querySelector("#chatLog"),
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput")
};

const ctx = els.wheelCanvas.getContext("2d");

drawWheel(DEFAULT_ITEMS);
els.startButton.disabled = true;
applyInviteFromUrl();

if (!firebaseReady) {
  els.setupStatus.textContent = "Firebase is not configured yet. Edit firebase-config.js first.";
} else {
  prepareAuth();
}

els.createMode.addEventListener("click", () => setMode("create"));
els.joinMode.addEventListener("click", () => setMode("join"));
els.startButton.addEventListener("click", start);
els.saveItems.addEventListener("click", () => configure(false));
els.releaseWheel.addEventListener("click", () => configure(true));
els.spinButton.addEventListener("click", spinWheel);
els.copyRoom.addEventListener("click", copyRoomId);
els.chatForm.addEventListener("submit", sendChatMessage);
window.addEventListener("resize", () => {
  if (state.room) {
    drawWheel(state.room.items);
  }
});

async function prepareAuth() {
  try {
    state.authUser = await ensureAnonymousAuth();
    els.startButton.disabled = false;
  } catch {
    els.setupStatus.textContent = "Could not start Firebase authentication.";
  }
}

function setMode(mode) {
  state.mode = mode;
  els.createMode.classList.toggle("is-active", mode === "create");
  els.joinMode.classList.toggle("is-active", mode === "join");
  els.roomIdField.hidden = mode !== "join";
  els.startButton.textContent = mode === "create" ? "Create room" : "Join room";
  els.setupStatus.textContent = "";
}

function applyInviteFromUrl() {
  const invitedRoomId = readInviteRoomId();

  if (!invitedRoomId) {
    return;
  }

  setMode("join");
  els.roomIdInput.value = invitedRoomId;
  els.setupStatus.textContent = "Enter your name to join this room.";

  requestAnimationFrame(() => {
    els.playerName.focus();
  });
}

function readInviteRoomId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("room") || params.get("r") || "";
}

async function start() {
  els.setupStatus.textContent = "";
  els.startButton.disabled = true;

  try {
    const name = cleanName(els.playerName.value);
    const user = state.authUser || await ensureAnonymousAuth();
    const clientId = user.uid;
    const role = state.mode === "create" ? "host" : "guest";
    const player = {
      id: clientId,
      role,
      name,
      joinedAt: now(),
      lastSeenAt: now()
    };

    if (state.mode === "create") {
      const room = makeRoom(player);
      await set(roomRef(room.id), room);
      enterRoom(room.id, player);
      return;
    }

    const parsedRoomId = parseRoomJoinId(els.roomIdInput.value);

    if (!parsedRoomId) {
      throw new Error("Please enter a Room ID.");
    }

    const guestPlayer = {
      ...player,
      ak: parsedRoomId.accessKey
    };

    await update(ref(db, `rooms/${parsedRoomId.roomId}/players/guest`), guestPlayer);
    await update(roomRef(parsedRoomId.roomId), { lastActiveAt: now() });
    enterRoom(parsedRoomId.roomId, guestPlayer);
  } catch (error) {
    els.setupStatus.textContent = state.mode === "join"
      ? "Room ID not found, expired, or already full."
      : error.message || "Start failed.";
    els.startButton.disabled = false;
  }
}

function enterRoom(roomId, player) {
  state.role = player.role;
  state.player = player;
  els.setupPanel.hidden = true;
  els.gamePanel.hidden = false;

  if (state.unsubscribeRoom) {
    state.unsubscribeRoom();
  }

  state.unsubscribeRoom = onValue(roomRef(roomId), async snapshot => {
    const room = snapshot.val();

    if (!room) {
      showMeta("Room no longer exists.");
      els.spinButton.disabled = true;
      return;
    }

    if (isExpired(room)) {
      await remove(roomRef(room.id)).catch(() => null);
      showMeta("The room expired after 24 hours of inactivity.");
      els.spinButton.disabled = true;
      return;
    }

    state.room = room;
    renderRoom();
    settleFinishedTarget(room).catch(() => null);
  });
}

async function configure(released) {
  if (!state.room || state.role !== "host") {
    showMeta("Only the host can edit the wheel.");
    return;
  }

  const items = normalizeItems(els.itemsInput.value);

  if (items.length < 2) {
    showMeta("Please enter at least two wheel entries.");
    return;
  }

  await update(ref(db), {
    [`rooms/${state.room.id}/items`]: items,
    [`rooms/${state.room.id}/released`]: released,
    [`rooms/${state.room.id}/spin`]: null,
    [`rooms/${state.room.id}/lastActiveAt`]: now()
  });
}

async function spinWheel() {
  if (!state.room || !state.player) {
    return;
  }

  if (isExpired(state.room) || !state.room.released || isActiveSpin(state.room)) {
    showMeta(isActiveSpin(state.room) ? "The wheel is already spinning." : "The wheel is not ready.");
    return;
  }

  const currentPlayer = findPlayer(state.room, state.player.id) || state.player;
  const actor = {
    name: currentPlayer.name,
    role: currentPlayer.role
  };
  const { spin, historyEntry, forcedSpin } = makeSpin(state.room, actor);
  const result = await runTransaction(ref(db, `rooms/${state.room.id}/spin`), currentSpin => {
    if (currentSpin && now() < currentSpin.endsAt) {
      return;
    }

    return spin;
  }, { applyLocally: false });

  if (!result.committed) {
    showMeta(isActiveSpin(state.room) ? "The wheel is already spinning." : "The wheel is not ready.");
    return;
  }

  const updates = {
    [`rooms/${state.room.id}/spinHistory/${historyEntry.id}`]: historyEntry,
    [`rooms/${state.room.id}/lastActiveAt`]: now()
  };

  if (forcedSpin) {
    updates[`rooms/${state.room.id}/${ROOM_META.pending}`] = null;
    updates[`rooms/${state.room.id}/${ROOM_META.note}`] = {
      state: "spinning",
      text: `Target spin running: ${historyEntry.item}.`,
      item: historyEntry.item,
      spinEndsAt: spin.endsAt,
      updatedAt: now()
    };
  }

  await update(ref(db), updates);
}

async function sendChatMessage(event) {
  event.preventDefault();

  if (!state.room || !state.player) {
    return;
  }

  const text = els.chatInput.value.trim();

  if (!text) {
    return;
  }

  try {
    const currentPlayer = findPlayer(state.room, state.player.id) || state.player;
    const encrypted = await encryptChatText(state.room.id, text);
    const id = newId();
    await update(ref(db, `rooms/${state.room.id}/chatMessages/${id}`), {
      id,
      uid: currentPlayer.id,
      author: currentPlayer.name,
      role: currentPlayer.role,
      createdAt: now(),
      ...encrypted
    });
    await update(roomRef(state.room.id), { lastActiveAt: now() });
    els.chatInput.value = "";
  } catch {
    showMeta("Could not encrypt chat message.");
  }
}

function renderRoom() {
  const room = state.room;
  const player = findPlayer(room, state.player.id) || state.player;
  const actualRole = player.role || state.role;

  els.roomCode.textContent = getRoomJoinId(room);
  els.expiryText.textContent = `Expires after inactivity: ${formatDate(expiryFrom(room))}`;
  els.hostTools.hidden = actualRole !== "host";
  els.guestNotice.hidden = actualRole === "host" || room.released;
  els.spinButton.disabled = !canSpin(room, actualRole);
  els.releaseWheel.textContent = room.released ? "Update" : "Unlock";

  if (document.activeElement !== els.itemsInput) {
    els.itemsInput.value = room.items.join("\n");
  }

  els.players.innerHTML = playersList(room)
    .map(entry => `
      <div class="player">
        <strong>${escapeHtml(entry.name)}</strong>
        <span class="badge">${entry.role === "host" ? "Host" : "Guest"}</span>
      </div>
    `)
    .join("");

  drawWheel(room.items);
  const spinSettledLocally = renderSpin(room, actualRole);
  renderSpinHistory(room, spinSettledLocally);
  renderChat(room);
}

function renderSpin(room, actualRole) {
  if (!room.spin) {
    state.activeSpinId = null;
    state.localSpinEndsAt = 0;
    els.hubText.textContent = room.released ? "Ready" : "Locked";
    els.spinMeta.textContent = room.released ? "Ready to spin" : "Waiting for unlock";
    els.resultText.textContent = "-";
    els.spinButton.disabled = !canSpin(room, actualRole);
    window.clearTimeout(state.spinTimer);
    return true;
  }

  const spin = room.spin;
  const winner = room.items[spin.winnerIndex] || "-";
  const remaining = Math.max(0, spin.endsAt - now());
  const isNewSpin = state.activeSpinId !== spin.id;

  if (isNewSpin) {
    state.activeSpinId = spin.id;
    state.localSpinEndsAt = now() + remaining + 250;
  }

  const localRemaining = Math.max(0, state.localSpinEndsAt - now());
  const showResult = remaining <= 0 && localRemaining <= 0;

  window.clearTimeout(state.spinTimer);
  els.hubText.textContent = showResult ? "Result" : "Spinning";
  els.spinMeta.textContent = showResult ? `${spin.by} spun` : `Active spin by ${spin.by}...`;
  els.resultText.textContent = showResult ? winner : "-";
  els.spinButton.disabled = !showResult || !canSpin(room, actualRole);

  if (isNewSpin) {
    requestAnimationFrame(() => {
      els.wheelCanvas.style.transitionDuration = `${remaining}ms`;
      els.wheelCanvas.style.transform = `rotate(${spin.finalRotation}deg)`;
      state.currentRotation = spin.finalRotation;
    });
  }

  if (!showResult) {
    state.spinTimer = window.setTimeout(() => {
      renderRoom();
    }, Math.max(remaining, localRemaining) + 100);
  }

  return showResult;
}

function renderSpinHistory(room, spinSettledLocally = true) {
  let entries = visibleSpinHistory(room);

  if (!spinSettledLocally && room.spin?.id) {
    entries = entries.filter(entry => entry.id !== room.spin.id);
  }

  els.spinHistory.innerHTML = entries.length
    ? entries.slice(0, 8).map(entry => `
      <div class="history-item">
        <div>
          <strong>${escapeHtml(entry.item)}</strong>
          <span>${formatTime(entry.startedAt)}</span>
        </div>
        <p>${escapeHtml(entry.by)} (${entry.byRole === "host" ? "Host" : "Guest"})</p>
      </div>
    `).join("")
    : '<p class="muted">No spins yet.</p>';
}

async function renderChat(room) {
  const version = state.chatRenderVersion + 1;
  state.chatRenderVersion = version;
  const messages = [];

  for (const message of chatList(room)) {
    let text = "[Could not decrypt]";

    try {
      text = await decryptChatText(room.id, message);
    } catch {
      text = "[Could not decrypt]";
    }

    if (version !== state.chatRenderVersion) {
      return;
    }

    messages.push({ ...message, text });
  }

  els.chatLog.innerHTML = messages.length
    ? messages.map(message => `
      <div class="chat-message">
        <div>
          <strong>${escapeHtml(message.author)}</strong>
          <span>${formatTime(message.createdAt)}</span>
        </div>
        <p>${escapeHtml(message.text)}</p>
      </div>
    `).join("")
    : '<p class="muted">No messages yet.</p>';

  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function drawWheel(items) {
  const canvas = els.wheelCanvas;
  const size = canvas.width;
  const center = size / 2;
  const radius = center - 18;
  const segment = (Math.PI * 2) / items.length;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(-Math.PI / 2);

  items.forEach((item, index) => {
    const start = index * segment;
    const end = start + segment;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = COLORS[index % COLORS.length];
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.82)";
    ctx.lineWidth = 8;
    ctx.stroke();

    ctx.save();
    ctx.rotate(start + segment / 2);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 34px Inter, system-ui, sans-serif";
    ctx.shadowColor = "rgba(0,0,0,0.22)";
    ctx.shadowBlur = 8;
    ctx.fillText(fitText(item, 18), radius - 34, 0);
    ctx.restore();
  });

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.lineWidth = 16;
  ctx.strokeStyle = "#fffaf0";
  ctx.stroke();
  ctx.restore();
}

function fitText(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function canSpin(room, actualRole) {
  return (actualRole === "host" || actualRole === "guest") && room.released && !isActiveSpin(room);
}

async function copyRoomId() {
  if (!state.room) {
    return;
  }

  try {
    await navigator.clipboard.writeText(makeInviteUrl(state.room));
    showMeta("Invite link copied.");
  } catch {
    showMeta("Could not copy invite link.");
  }
}

function makeInviteUrl(room) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", getRoomJoinId(room));

  return url.toString();
}

function showMeta(text) {
  els.spinMeta.textContent = text;
}
