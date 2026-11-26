/**
 * 0. ONLINE SERVER CONFIGURATION & SOCKET CONNECTION
 */
const SERVER_URL = 'https://shawzen-online-server.onrender.com';
let socket = null;

const OnlineSession = {
  connected: false,
  socketId: null,
  myPlayerId: null,
  roomId: null,
  isHost: false,
  isOnlineMatch: false,
  lastShownRound: 0,
  pendingJoinCode: null,
  joinTimeoutTimer: null,
  serverPlayers: [],
  lobbyBots: []
};

// Map server item IDs <-> client item IDs seamlessly
const SERVER_TO_CLIENT_ITEM = {
  magnifier: 'glass',
  glass: 'glass',
  saw: 'saw',
  soda: 'drink',
  drink: 'drink',
  medkit: 'smoke',
  smoke: 'smoke',
  paracetamol: 'smoke',
  cuffs: 'cuffs',
  thief: 'thief',
  exchanger: 'swapper',
  swapper: 'swapper',
  inverter: 'flipper',
  flipper: 'flipper',
  shield: 'shield',
  pillow: 'pillow'
};

const SERVER_TO_CLIENT_WEAPON = {
  shotgun: 'shotgun',
  pistol: 'pistol',
  ak: 'ak47',
  ak47: 'ak47',
  bazooka: 'bazooka',
  cannon: 'cannon'
};

const CLIENT_TO_SERVER_WEAPON = {
  shotgun: 'shotgun',
  pistol: 'pistol',
  ak47: 'ak',
  bazooka: 'bazooka',
  cannon: 'cannon'
};

const SERVER_TO_CLIENT_SKIN = {
  classic: 'classic',
  gold: 'gold',
  neon: 'crimson',
  crimson: 'crimson',
  shadow: 'carbon',
  carbon: 'carbon',
  sumerian: 'sumerian',
  egyptian: 'egyptian'
};

const CLIENT_TO_SERVER_SKIN = {
  classic: 'classic',
  gold: 'gold',
  crimson: 'neon',
  carbon: 'shadow',
  sumerian: 'sumerian',
  egyptian: 'egyptian'
};

function mapServerItem(key) {
  return SERVER_TO_CLIENT_ITEM[key] || key;
}

function mapServerWeapon(w) {
  return SERVER_TO_CLIENT_WEAPON[w] || 'shotgun';
}

function mapServerSkin(s) {
  return SERVER_TO_CLIENT_SKIN[s] || 'classic';
}

function emitCreateRoomToServer() {
  if (!socket || !OnlineSession.connected) return;
  const payload = {
    name: 'المضيف',
    maxPlayers: AppState.maxRoomPlayers,
    timerMax: AppState.turnDuration,
    weapon: CLIENT_TO_SERVER_WEAPON[AppState.equippedWeapon] || AppState.equippedWeapon,
    skin: CLIENT_TO_SERVER_SKIN[AppState.equippedSkin] || AppState.equippedSkin
  };
  socket.emit('create_room', payload);
}

function emitJoinRoomToServer(roomCode) {
  if (!socket || !OnlineSession.connected) return;
  const payload = {
    code: roomCode,
    roomId: roomCode,
    name: 'صديق',
    weapon: CLIENT_TO_SERVER_WEAPON[AppState.equippedWeapon] || AppState.equippedWeapon,
    skin: CLIENT_TO_SERVER_SKIN[AppState.equippedSkin] || AppState.equippedSkin
  };
  socket.emit('join_room', payload);
}

function clearJoinPendingState() {
  if (OnlineSession.joinTimeoutTimer) {
    clearTimeout(OnlineSession.joinTimeoutTimer);
    OnlineSession.joinTimeoutTimer = null;
  }
  const btn = document.getElementById('submitJoinBtn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'دخول الغرفة';
  }
}

function handleJoinFailure(msg) {
  clearJoinPendingState();
  OnlineSession.roomId = null;
  OnlineSession.isHost = false;
  OnlineSession.myPlayerId = null;
  const joinErrEl = document.getElementById('joinErrorText');
  toggleModal('joinRoomModal', true);
  if (joinErrEl) {
    joinErrEl.textContent = msg || 'لم يتم العثور على غرفة بهذا الرمز أو أنها ممتلئة!';
  }
}

function rebuildCombinedLobbySeats() {
  const maxSlots = AppState.maxRoomPlayers || 6;
  const humans = (OnlineSession.serverPlayers || []).map((p, idx) => {
    const isMe = (OnlineSession.myPlayerId !== null && p.id === OnlineSession.myPlayerId) ||
                 (socket && p.socketId === socket.id);
    const isRoomHost = (p.id === 0 || p.id === OnlineSession.hostId);
    return {
      id: p.id,
      name: isMe
        ? (isRoomHost ? 'أنت (المضيف)' : 'أنت')
        : (p.name || (isRoomHost ? 'المضيف' : `لاعب ${idx + 1}`)),
      avatar: isMe ? '😎' : (p.isBot ? '🤖' : '🧑🏻'),
      isBot: Boolean(p.isBot),
      isSelf: isMe,
      weaponId: isMe ? AppState.equippedWeapon : mapServerWeapon(p.weapon || p.weaponId),
      skinId: isMe ? AppState.equippedSkin : mapServerSkin(p.skin || p.skinId)
    };
  });

  // Trim local lobby bots so total seats never exceed maxSlots
  const availableForBots = Math.max(0, maxSlots - humans.length);
  if (OnlineSession.lobbyBots.length > availableForBots) {
    OnlineSession.lobbyBots = OnlineSession.lobbyBots.slice(0, availableForBots);
  }

  AppState.lobbySeats = [...humans, ...OnlineSession.lobbyBots];
  const botCtrl = document.getElementById('lobbyBotControls');
  if (botCtrl) {
    botCtrl.style.display = OnlineSession.isHost ? 'flex' : 'none';
  }
  renderLobbySeats();
}

function handleServerRoomState(data) {
  if (!data) return;
  clearJoinPendingState();
  AppState.pendingRoomCreate = false;
  toggleModal('joinRoomModal', false);

  const serverCode = normalizeRoomCode(data.code || data.roomId || OnlineSession.roomId || AppState.roomCode);
  if (serverCode) {
    OnlineSession.roomId = serverCode;
    AppState.roomCode = serverCode;
  }

  if (typeof data.myPlayerId !== 'undefined' && data.myPlayerId !== null) {
    OnlineSession.myPlayerId = data.myPlayerId;
  }
  if (typeof data.hostId !== 'undefined' && data.hostId !== null) {
    OnlineSession.hostId = data.hostId;
  }

  // Correctly compare numeric myPlayerId (e.g. 0) with numeric hostId (e.g. 0)
  if (OnlineSession.myPlayerId !== null && typeof data.hostId !== 'undefined') {
    OnlineSession.isHost = (OnlineSession.myPlayerId === data.hostId);
  } else if (data.hostId && socket && typeof data.hostId === 'string') {
    OnlineSession.isHost = (data.hostId === socket.id);
  }

  if (typeof data.timerMax === 'number') {
    AppState.turnDuration = data.timerMax;
  } else if (typeof data.turnDuration === 'number') {
    AppState.turnDuration = data.turnDuration;
  }

  if (typeof data.maxPlayers === 'number') {
    AppState.maxRoomPlayers = data.maxPlayers;
  }

  // If the match has started on the server, switch straight to the active game screen!
  if (data.started) {
    if (!OnlineSession.isOnlineMatch) {
      OnlineSession.isOnlineMatch = true;
      OnlineSession.lastShownRound = 0;
    }
    applyOnlineServerState(data, !AppState.match.active);
    return;
  }

  const codeEl = document.getElementById('generatedRoomCode');
  if (codeEl) codeEl.textContent = AppState.roomCode;

  setRoomSyncStatus(OnlineSession.isHost ? 'مُزامنة مع السيرفر ✓' : 'متصل بالغرفة ✓', true);
  setupLobbyUI({
    badge: OnlineSession.isHost
      ? `غرفة خاصة أونلاين (حتى ${AppState.maxRoomPlayers} لاعبين)`
      : `غرفة خاصة أونلاين (${AppState.roomCode})`,
    title: OnlineSession.isHost ? 'غرفة التحدي الجماعي' : 'تم الانضمام للغرفة بنجاح!',
    subtitle: OnlineSession.isHost
      ? 'شارك الرمز مع أصدقائك أو أضف بوتات ثم اضغط بدء المواجهة'
      : 'بانتظار بدء الجولة من المضيف',
    showCodeBox: true,
    showHostSettings: true
  });
  updateDurationButtonsUI(AppState.turnDuration, OnlineSession.isHost);
  updateMaxPlayersButtonsUI(AppState.maxRoomPlayers, OnlineSession.isHost);

  OnlineSession.serverPlayers = Array.isArray(data.players) ? data.players : [];
  rebuildCombinedLobbySeats();
  showScreen('screen-lobby');
}

function initServerConnection() {
  if (typeof io === 'undefined') {
    updateServerStatusUI(false, 'وضع الأوفلاين (تعذر تحميل Socket.IO)');
    return;
  }

  socket = io(SERVER_URL, {
    transports: ['polling', 'websocket'],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 15,
    timeout: 20000
  });

  socket.on('connect', () => {
    OnlineSession.connected = true;
    OnlineSession.socketId = socket.id;
    updateServerStatusUI(true, 'متصل بالسيرفر الأونلاين ✓');
    setRoomSyncStatus('متصل بالسيرفر ✓', true);

    if (AppState.pendingRoomCreate && AppState.currentMode === 'private' && OnlineSession.isHost) {
      AppState.pendingRoomCreate = false;
      emitCreateRoomToServer();
    }

    if (OnlineSession.pendingJoinCode) {
      const codeToJoin = OnlineSession.pendingJoinCode;
      OnlineSession.pendingJoinCode = null;
      emitJoinRoomToServer(codeToJoin);
    }
  });

  socket.on('disconnect', () => {
    OnlineSession.connected = false;
    updateServerStatusUI(false, 'انقطع الاتصال بالسيرفر...');
    setRoomSyncStatus('جاري إعادة الاتصال...', false);
  });

  socket.on('connect_error', () => {
    OnlineSession.connected = false;
    updateServerStatusUI(false, 'جاري إيقاظ السيرفر...');
    setRoomSyncStatus('إيقاظ السيرفر...', false);
  });

  // Main authoritative state event from server.js
  socket.on('room_state', (data) => {
    handleServerRoomState(data);
  });

  socket.on('room_created', (data) => {
    handleServerRoomState(data);
  });

  socket.on('room_updated', (data) => {
    handleServerRoomState(data);
  });

  socket.on('error_msg', (msg) => {
    const text = (typeof msg === 'string') ? msg : (msg && msg.message ? msg.message : 'حدث خطأ في الغرفة');
    if (OnlineSession.joinTimeoutTimer || !document.getElementById('joinRoomModal').classList.contains('hidden')) {
      handleJoinFailure(text);
    } else if (AppState.match.active) {
      setActionBanner(`⚠️ ${text}`, 'danger', true);
    } else {
      alert(text);
    }
  });

  socket.on('timer_tick', (secondsLeft) => {
    if (!OnlineSession.isOnlineMatch || !AppState.match.active) return;
    if (typeof secondsLeft === 'number') {
      AppState.match.timeLeft = secondsLeft;
      updateTimerDisplay();
    }
  });

  socket.on('shot_animation', (ev) => {
    if (!ev) return;
    const m = AppState.match;
    const target = m.players.find(p => p.id === ev.targetId);
    if (target) {
      aimShotgunAtTarget(target, true);
      setTimeout(resetShotgunAim, 900);
    }
    if (ev.shell === 'live') {
      AudioEngine.liveBlast();
      triggerShellEjectAnimation('live');
      const flash = document.getElementById('muzzleFlash');
      if (flash) {
        flash.classList.remove('flash-active');
        void flash.offsetWidth;
        flash.classList.add('flash-active');
      }
      const frame = document.getElementById('appFrame');
      if (frame) {
        frame.classList.remove('shake-screen');
        void frame.offsetWidth;
        frame.classList.add('shake-screen');
      }
      if (target) {
        triggerBloodEffect(target, m.doubleDamage ? 2 : 1);
      }
    } else {
      AudioEngine.blankClick();
      triggerShellEjectAnimation('blank');
    }
  });

  socket.on('private_hint', (hintText) => {
    const text = String(hintText || '');
    if (text.includes('العدسة')) {
      const isLive = text.includes('حية');
      const box = document.getElementById('peekResultBox');
      if (isLive) {
        box.className = 'my-4 py-4 px-3 rounded-2xl border border-red-500 bg-red-500/15 text-red-400 font-black text-lg flex flex-col items-center gap-2';
        box.innerHTML = `${createShellSVG('live', 'w-9 h-16')}<span>🔴 رصاصة حية (LIVE)</span>`;
      } else {
        box.className = 'my-4 py-4 px-3 rounded-2xl border border-sky-500 bg-sky-500/15 text-sky-400 font-black text-lg flex flex-col items-center gap-2';
        box.innerHTML = `${createShellSVG('blank', 'w-9 h-16')}<span>⚪ رصاصة فارغة (BLANK)</span>`;
      }
      toggleModal('peekModal', true);
    } else {
      setActionBanner(text, 'safe', true);
    }
  });

  socket.on('thief_reveal', (data) => {
    if (!data) return;
    const pending = AppState.pendingTargetedItem;
    if (!pending || pending.type !== 'thief') return;

    const targetOpp = AppState.match.players.find(p => p.id === data.targetId);
    const targetName = data.targetName || (targetOpp ? targetOpp.name : 'الخصم');
    const rawItems = Array.isArray(data.items) ? data.items : [];

    if (rawItems.length === 0) {
      AudioEngine.blankClick();
      document.getElementById('pickerModalSubtitle').textContent = `⚠️ مخزون ${targetName} فارغ تماماً! اختر خصماً آخر.`;
      return;
    }

    pending.selectedOppId = data.targetId;
    AudioEngine.itemUse();

    document.getElementById('pickerModalTitle').textContent = `أدوات ${targetName} المكشوفة`;
    document.getElementById('pickerModalSubtitle').textContent = 'اختر الأداة التي تريد سرقتها وإضافتها لخاناتك:';

    const listEl = document.getElementById('pickerOpponentsList');
    const itemsBoxEl = document.getElementById('pickerOpponentItemsBox');
    const itemsGridEl = document.getElementById('pickerOpponentItemsGrid');
    const backBtnEl = document.getElementById('pickerBackBtn');

    listEl.classList.add('hidden');
    itemsBoxEl.classList.remove('hidden');
    backBtnEl.classList.remove('hidden');
    itemsGridEl.innerHTML = '';

    rawItems.forEach((rawKey, oppItemIdx) => {
      const clientKey = mapServerItem(rawKey);
      const itemInfo = ITEMS_DB[clientKey];
      if (!itemInfo) return;
      const itemBtn = document.createElement('button');
      itemBtn.type = 'button';
      itemBtn.className = 'p-2.5 rounded-2xl bg-zinc-950 hover:bg-amber-500/20 border border-zinc-700 hover:border-amber-400 flex flex-col items-center justify-center gap-1 transition cursor-pointer';
      itemBtn.innerHTML = `
        <span class="text-2xl">${itemInfo.icon}</span>
        <span class="text-[10px] font-black text-white text-center leading-tight">${itemInfo.name}</span>
      `;
      itemBtn.onclick = () => {
        toggleModal('opponentPickerModal', false);
        AppState.pendingTargetedItem = null;
        socket.emit('use_item', {
          slotIndex: pending.slotIndex,
          targetId: data.targetId,
          stealIndex: oppItemIdx
        });
      };
      itemsGridEl.appendChild(itemBtn);
    });
  });

  socket.on('game_over', (data) => {
    OnlineSession.isOnlineMatch = false;
    const won = Boolean(data && data.winnerId !== null && data.winnerId === OnlineSession.myPlayerId);
    endMatch(won);
  });

  socket.on('match_ended', (data) => {
    OnlineSession.isOnlineMatch = false;
    const won = Boolean(data && (data.winnerId === OnlineSession.myPlayerId || data.won));
    endMatch(won);
  });
}

function updateServerStatusUI(isOnline, labelText) {
  const sub = document.getElementById('serverStatusText');
  const dot = document.getElementById('onlineStatusDot');
  const lbl = document.getElementById('onlineStatusLabel');
  if (sub) {
    sub.textContent = labelText;
    sub.className = isOnline
      ? 'text-[10px] text-emerald-400 font-semibold'
      : 'text-[10px] text-amber-400 font-semibold';
  }
  if (dot) {
    dot.className = isOnline
      ? 'w-2 h-2 rounded-full bg-emerald-400 animate-ping'
      : 'w-2 h-2 rounded-full bg-amber-400 animate-ping';
  }
  if (lbl) {
    lbl.textContent = isOnline
      ? 'متصل أونلاين • 5 أسلحة • 6 مظاهر • 10 أدوات'
      : 'جاري الاتصال بالسيرفر • 5 أسلحة • 6 مظاهر • 10 أدوات';
  }
}

function applyOnlineServerState(state, isInitial) {
  if (!state || !Array.isArray(state.players)) return;
  const m = AppState.match;
  m.active = true;
  m.round = state.round || 1;
  m.maxHp = 5;
  m.doubleDamage = Boolean(state.sawed || state.doubleDamage);

  const myPid = OnlineSession.myPlayerId;
  const myIdx = state.players.findIndex(p => p.id === myPid);
  const ordered = myIdx >= 0
    ? [...state.players.slice(myIdx), ...state.players.slice(0, myIdx)]
    : [...state.players];

  m.players = ordered.map((p, idx) => {
    const isMe = (p.id === myPid);
    const hpVal = typeof p.hearts === 'number' ? p.hearts : (typeof p.hp === 'number' ? p.hp : 5);
    const mappedItems = Array.isArray(p.items) ? p.items.map(mapServerItem) : [];
    return {
      id: p.id,
      name: isMe ? 'أنت' : (p.name || `لاعب ${idx + 1}`),
      avatar: isMe ? '😎' : (p.isBot ? '🤖' : '🧑🏻'),
      isBot: Boolean(p.isBot),
      isSelf: isMe,
      weaponId: isMe ? AppState.equippedWeapon : mapServerWeapon(p.weapon || p.weaponId),
      skinId: isMe ? AppState.equippedSkin : mapServerSkin(p.skin || p.skinId),
      hp: hpVal,
      maxHp: 5,
      eliminated: hpVal <= 0,
      cuffed: Boolean(p.cuffed),
      hasShield: Boolean(p.shield || p.hasShield),
      pillowTurns: p.pillowTurns || 0,
      itemsCount: typeof p.itemsCount === 'number' ? p.itemsCount : mappedItems.length,
      items: mappedItems
    };
  });

  const activeRawPlayer = state.players[state.turnIndex];
  const activePlayerId = activeRawPlayer ? activeRawPlayer.id : 0;
  const mappedTurnIdx = m.players.findIndex(p => p.id === activePlayerId);
  m.turnIndex = mappedTurnIdx >= 0 ? mappedTurnIdx : 0;

  if (typeof state.remainingShells === 'number') {
    m.chamber = new Array(state.remainingShells).fill('unknown');
  } else if (Array.isArray(state.chamber)) {
    m.chamber = state.chamber;
  }

  if (typeof state.timerMax === 'number') {
    AppState.turnDuration = state.timerMax;
  }
  if (typeof state.timerLeft === 'number') {
    m.timeLeft = state.timerLeft;
    updateTimerDisplay();
  }

  updateShotgunBarrelVisual(m.doubleDamage);
  ensureValidSelectedTarget();

  if (isInitial) {
    showScreen('screen-game');
  }

  // Show round shells reveal modal at the beginning of each new round
  if (m.round !== OnlineSession.lastShownRound && (state.roundLiveCount > 0 || state.roundBlankCount > 0)) {
    OnlineSession.lastShownRound = m.round;
    const liveCnt = state.roundLiveCount || 0;
    const blankCnt = state.roundBlankCount || 0;
    document.getElementById('modalRoundNum').textContent = m.round;
    document.getElementById('revealLiveCount').textContent = liveCnt;
    document.getElementById('revealBlankCount').textContent = blankCnt;

    const listEl = document.getElementById('revealShellsList');
    listEl.innerHTML = '';
    for (let i = 0; i < liveCnt; i++) {
      const w = document.createElement('div');
      w.className = 'flex flex-col items-center gap-1 bg-zinc-900/90 px-2.5 py-2 rounded-2xl border border-red-500/40';
      w.innerHTML = `${createShellSVG('live', 'w-7 h-12')}<span class="text-[10px] font-black text-red-400">حية</span>`;
      listEl.appendChild(w);
    }
    for (let i = 0; i < blankCnt; i++) {
      const w = document.createElement('div');
      w.className = 'flex flex-col items-center gap-1 bg-zinc-900/90 px-2.5 py-2 rounded-2xl border border-sky-500/40';
      w.innerHTML = `${createShellSVG('blank', 'w-7 h-12')}<span class="text-[10px] font-black text-sky-300">فارغة</span>`;
      listEl.appendChild(w);
    }
    toggleModal('roundRevealOverlay', true);
    setTimeout(() => {
      toggleModal('roundRevealOverlay', false);
      AudioEngine.rack();
    }, 2000);
  }

  if (state.lastLog) {
    setActionBanner(state.lastLog, 'neutral', true);
  } else {
    const activeP = getCurrentTurnPlayer();
    if (activeP) {
      setActionBanner(activeP.isSelf ? 'دورك الآن! اختر خصماً أو أداة للعب 🎯' : `دور ${activeP.name} الآن...`, 'neutral', false);
    }
  }

  const activeP = getCurrentTurnPlayer();
  if (activeP && activeP.isSelf) {
    const targetObj = m.players.find(p => p.id === m.selectedTargetId);
    aimShotgunAtTarget(targetObj, false);
  }

  renderGameUI();
}

/**
 * 1. SVG 3D SHOTGUN SHELL GENERATOR
 */
let shellSvgCounter = 0;
function createShellSVG(type, sizeClass = 'w-6 h-11') {
  shellSvgCounter++;
  const uid = shellSvgCounter;
  if (type === 'live') {
    return `
      <svg viewBox="0 0 28 52" class="${sizeClass} drop-shadow-[0_4px_8px_rgba(239,68,68,0.5)]">
        <defs>
          <linearGradient id="liveHull_${uid}" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#7f1d1d"/>
            <stop offset="35%" stop-color="#ef4444"/>
            <stop offset="70%" stop-color="#dc2626"/>
            <stop offset="100%" stop-color="#450a0a"/>
          </linearGradient>
          <linearGradient id="liveBrass_${uid}" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#92400e"/>
            <stop offset="40%" stop-color="#fde047"/>
            <stop offset="75%" stop-color="#eab308"/>
            <stop offset="100%" stop-color="#713f12"/>
          </linearGradient>
        </defs>
        <path d="M6,4 Q14,1 22,4 L22,35 L6,35 Z" fill="url(#liveHull_${uid})" stroke="#fca5a5" stroke-width="0.9"/>
        <line x1="6" y1="10" x2="22" y2="10" stroke="#7f1d1d" stroke-width="1.1"/>
        <line x1="6" y1="16" x2="22" y2="16" stroke="#7f1d1d" stroke-width="1.1"/>
        <line x1="6" y1="22" x2="22" y2="22" stroke="#7f1d1d" stroke-width="1.1"/>
        <rect x="9" y="6" width="2.5" height="26" rx="1" fill="#ffffff" fill-opacity="0.25"/>
        <rect x="5" y="35" width="18" height="12" rx="1.5" fill="url(#liveBrass_${uid})" stroke="#fef08a" stroke-width="0.7"/>
        <rect x="3.5" y="46.5" width="21" height="3" rx="1.2" fill="#facc15" stroke="#a16207" stroke-width="0.6"/>
      </svg>
    `;
  }
  return `
    <svg viewBox="0 0 28 52" class="${sizeClass} drop-shadow-[0_4px_8px_rgba(56,189,248,0.45)]">
      <defs>
        <linearGradient id="blankHull_${uid}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#075985"/>
          <stop offset="40%" stop-color="#7dd3fc"/>
          <stop offset="75%" stop-color="#0284c7"/>
          <stop offset="100%" stop-color="#0c4a6e"/>
        </linearGradient>
        <linearGradient id="blankSteel_${uid}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#52525b"/>
          <stop offset="40%" stop-color="#f4f4f5"/>
          <stop offset="75%" stop-color="#a1a1aa"/>
          <stop offset="100%" stop-color="#27272a"/>
        </linearGradient>
      </defs>
      <path d="M6,4 Q14,1 22,4 L22,35 L6,35 Z" fill="url(#blankHull_${uid})" fill-opacity="0.88" stroke="#bae6fd" stroke-width="0.9"/>
      <circle cx="14" cy="18" r="4.2" fill="none" stroke="#e0f2fe" stroke-width="1.1" stroke-dasharray="2.5 1.5"/>
      <rect x="9" y="6" width="2.5" height="26" rx="1" fill="#ffffff" fill-opacity="0.32"/>
      <rect x="5" y="35" width="18" height="12" rx="1.5" fill="url(#blankSteel_${uid})" stroke="#ffffff" stroke-width="0.7"/>
      <rect x="3.5" y="46.5" width="21" height="3" rx="1.2" fill="#d4d4d8" stroke="#52525b" stroke-width="0.6"/>
    </svg>
  `;
}

/**
 * 2. PROCEDURAL WEB AUDIO ENGINE & HAPTICS
 */
const AudioEngine = (() => {
  let ctx = null;
  let isMuted = false;

  function init() {
    try {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
    } catch (e) {}
  }

  function vibrate(pattern) {
    try {
      if (navigator.vibrate) {
        navigator.vibrate(pattern);
      }
    } catch (e) {}
  }

  function toggleMute() {
    isMuted = !isMuted;
    return isMuted;
  }

  function playTone(freq, type, duration, vol = 0.2, slideTo = null) {
    if (isMuted) return;
    init();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slideTo) {
        osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
      }
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {}
  }

  function playNoise(duration, filterFreq = 800, vol = 0.4) {
    if (isMuted) return;
    init();
    if (!ctx) return;
    try {
      const bufferSize = ctx.sampleRate * duration;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate || 44100);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(filterFreq, ctx.currentTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start();
    } catch (e) {}
  }

  return {
    toggleMute,
    vibrate,
    rack: () => {
      playTone(220, 'sawtooth', 0.08, 0.15, 340);
      setTimeout(() => playTone(310, 'square', 0.09, 0.15, 190), 110);
    },
    liveBlast: () => {
      vibrate([90, 40, 120]);
      playNoise(0.55, 1100, 0.65);
      playTone(110, 'sawtooth', 0.45, 0.5, 28);
    },
    bloodHit: () => {
      playNoise(0.28, 650, 0.35);
      playTone(150, 'sine', 0.25, 0.3, 55);
    },
    blankClick: () => {
      vibrate(25);
      playTone(950, 'triangle', 0.05, 0.25, 400);
      setTimeout(() => playTone(1200, 'sine', 0.04, 0.15), 55);
    },
    itemUse: () => {
      vibrate(20);
      playTone(440, 'sine', 0.12, 0.18, 660);
    },
    shieldBlock: () => {
      vibrate([40, 30, 60]);
      playTone(520, 'triangle', 0.15, 0.25, 880);
      setTimeout(() => playTone(780, 'sine', 0.2, 0.22, 420), 100);
    },
    pillowSoft: () => {
      vibrate(30);
      playNoise(0.22, 420, 0.3);
      playTone(260, 'sine', 0.22, 0.22, 160);
    },
    sawSound: () => {
      vibrate([30, 20, 30]);
      playTone(180, 'sawtooth', 0.25, 0.22, 520);
    },
    healSound: () => {
      playTone(330, 'sine', 0.15, 0.2, 440);
      setTimeout(() => playTone(440, 'sine', 0.2, 0.2, 587), 130);
    },
    win: () => {
      vibrate([60, 40, 80, 40, 120]);
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        setTimeout(() => playTone(f, 'triangle', 0.25, 0.2), i * 110);
      });
    },
    lose: () => {
      vibrate(150);
      [320, 280, 240, 180].forEach((f, i) => {
        setTimeout(() => playTone(f, 'sawtooth', 0.28, 0.18), i * 140);
      });
    }
  };
})();

/**
 * 3. ITEM CATALOG (10 ITEMS), WEAPON TYPES (5 WEAPONS) & SKINS (6 SKINS)
 */
const MAX_ITEM_SLOTS = 7;

const ITEMS_DB = {
  glass: {
    id: 'glass',
    name: 'عدسة مكبرة',
    icon: '🔍',
    desc: 'تكشف لك سراً نوع الرصاصة الحالية في بيت النار (حية أم فارغة) دون علم الخصم.'
  },
  saw: {
    id: 'saw',
    name: 'منشار يدوي',
    icon: '🪚',
    desc: 'يقص فوهة السلاح ليضاعف ضرر الطلقة الحية القادمة إلى 2 نقطة صحة.'
  },
  drink: {
    id: 'drink',
    name: 'شراب الطاقة',
    icon: '🥤',
    desc: 'يسحب أقسام السلاح ويُخرج الرصاصة الحالية دون إطلاقها مع كشف نوعها للجميع.'
  },
  cuffs: {
    id: 'cuffs',
    name: 'قيود حديدية',
    icon: '⛓️',
    desc: 'تُقيّد الخصم وتجعله يتخطى دوره القادم بالكامل.'
  },
  smoke: {
    id: 'smoke',
    name: 'براسيتول',
    icon: '💊',
    desc: 'يُسكّن الألم ويستعيد +1 نقطة من شريط الصحة الخاص بك فوراً.'
  },
  thief: {
    id: 'thief',
    name: 'السارق',
    icon: '🦝',
    desc: 'يكشف عدد أدوات خصومك، وعند اختيار خصم يكشف لك جميع أدواته لتختار الأداة التي تريد سرقتها.'
  },
  swapper: {
    id: 'swapper',
    name: 'المبادل',
    icon: '🔄',
    desc: 'يقوم بتبديل جميع أدواتك الحالية مع جميع أدوات أي خصم تختاره داخل الغرفة.'
  },
  flipper: {
    id: 'flipper',
    name: 'القلاب',
    icon: '🔁',
    desc: 'يقلب الرصاصة الحالية داخل السلاح (إن كانت فارغة تتحول حية، وإن كانت حية تتحول فارغة).'
  },
  shield: {
    id: 'shield',
    name: 'الدرع',
    icon: '🛡️',
    desc: 'يحميك من الأدوات التي يستخدمها الخصوم ضدك (السارق، المبادل، والقيود) ويبقى فعالاً حتى يصد أداة واحدة فيُلغى.'
  },
  pillow: {
    id: 'pillow',
    name: 'الوسادة السرية',
    icon: '🛏️',
    desc: 'تحميك سراً من ضربة الرصاصة الحية لمرة واحدة لمدة دورين دون أن يظهر للخصوم أنك استخدمتها.'
  }
};

const WEAPON_TYPES = [
  { id: 'shotgun', name: 'شوتكن', icon: '🔫', price: 0, badge: 'مجاني • كلاسيكي' },
  { id: 'pistol', name: 'مسدس', icon: '🔫', price: 6, badge: 'خفيف وسريع' },
  { id: 'ak47', name: 'كلاشنكوف', icon: '💥', price: 10, badge: 'هجومي تكتيكي' },
  { id: 'bazooka', name: 'بازوكا', icon: '🚀', price: 14, badge: 'قاذف صاروخي' },
  { id: 'cannon', name: 'مدفع', icon: '💣', price: 18, badge: 'مدفع حربي ثقيل' }
];

const WEAPON_SKINS = [
  {
    id: 'classic',
    name: 'الفولاذ الكلاسيكي',
    price: 0,
    badge: 'مجاني',
    glow: 'drop-shadow-[0_12px_14px_rgba(0,0,0,0.85)]',
    stock: '#451a03',
    stockStroke: '#78350f',
    receiver: '#27272a',
    receiverStroke: '#52525b',
    barrel: '#3f3f46',
    barrelStroke: '#71717a',
    pump: '#78350f',
    sight: '#ef4444'
  },
  {
    id: 'gold',
    name: 'الذهب الملكي',
    price: 8,
    badge: 'أسطوري 👑',
    glow: 'drop-shadow-[0_0_14px_rgba(234,179,8,0.45)]',
    stock: '#713f12',
    stockStroke: '#eab308',
    receiver: '#eab308',
    receiverStroke: '#fef08a',
    barrel: '#fde047',
    barrelStroke: '#ca8a04',
    pump: '#18181b',
    sight: '#38bdf8'
  },
  {
    id: 'crimson',
    name: 'النيون القرمزي',
    price: 12,
    badge: 'ناري 🔥',
    glow: 'drop-shadow-[0_0_14px_rgba(239,68,68,0.5)]',
    stock: '#450a0a',
    stockStroke: '#ef4444',
    receiver: '#991b1b',
    receiverStroke: '#f87171',
    barrel: '#ef4444',
    barrelStroke: '#fecaca',
    pump: '#18181b',
    sight: '#fde047'
  },
  {
    id: 'carbon',
    name: 'التكتيكي الأسود',
    price: 15,
    badge: 'نخبة ⚡',
    glow: 'drop-shadow-[0_0_14px_rgba(56,189,248,0.45)]',
    stock: '#09090b',
    stockStroke: '#0284c7',
    receiver: '#18181b',
    receiverStroke: '#38bdf8',
    barrel: '#0284c7',
    barrelStroke: '#7dd3fc',
    pump: '#0c4a6e',
    sight: '#34d399'
  },
  {
    id: 'sumerian',
    name: 'الحضارة السومرية 🏛️',
    price: 18,
    badge: 'بلاد الرافدين • لازورد وذهب',
    glow: 'drop-shadow-[0_0_16px_rgba(45,212,191,0.55)]',
    stock: '#4c1d05',
    stockStroke: '#eab308',
    receiver: 'url(#sumerianGold)',
    receiverStroke: '#fef08a',
    barrel: 'url(#sumerianLapis)',
    barrelStroke: '#fde047',
    pump: '#1e3a8a',
    sight: '#2dd4bf'
  },
  {
    id: 'egyptian',
    name: 'الحضارة المصرية 🏺',
    price: 22,
    badge: 'إرث الفراعنة • عين حورس',
    glow: 'drop-shadow-[0_0_16px_rgba(250,204,21,0.6)]',
    stock: '#09090b',
    stockStroke: '#facc15',
    receiver: 'url(#egyptianGold)',
    receiverStroke: '#fef08a',
    barrel: '#18181b',
    barrelStroke: '#eab308',
    pump: 'url(#egyptianTurquoise)',
    sight: '#facc15'
  }
];

const ITEM_KEYS = Object.keys(ITEMS_DB);
const BOT_NAMES_POOL = ['Bot_Alpha', 'Bot_Sniper', 'Bot_Shadow', 'Bot_Viper', 'Bot_Ghost'];
const BOT_AVATARS = ['🤖', '🦾', '👾', '🎭', '💀'];

/**
 * 4. DYNAMIC WEAPON + SKIN SVG RENDERER (5 WEAPONS x 6 SKINS)
 */
let weaponSvgUid = 0;
function renderWeaponSVG(weaponId, skinId, isSawed = false, sizeClass = 'w-full h-full') {
  weaponSvgUid++;
  const uid = weaponSvgUid;
  const skin = WEAPON_SKINS.find(s => s.id === skinId) || WEAPON_SKINS[0];

  const resolveFill = (val) => {
    if (!val || !val.startsWith('url(#')) return val;
    return val.replace(')', `_${uid})`);
  };

  const stockFill = resolveFill(skin.stock);
  const receiverFill = resolveFill(skin.receiver);
  const barrelFill = resolveFill(skin.barrel);
  const pumpFill = resolveFill(skin.pump);

  const defsHtml = `
    <defs>
      <linearGradient id="sumerianLapis_${uid}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#172554"/><stop offset="50%" stop-color="#1d4ed8"/><stop offset="100%" stop-color="#1e3a8a"/>
      </linearGradient>
      <linearGradient id="sumerianGold_${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#fef08a"/><stop offset="50%" stop-color="#eab308"/><stop offset="100%" stop-color="#a16207"/>
      </linearGradient>
      <linearGradient id="egyptianGold_${uid}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#b45309"/><stop offset="45%" stop-color="#facc15"/><stop offset="75%" stop-color="#fde047"/><stop offset="100%" stop-color="#92400e"/>
      </linearGradient>
      <linearGradient id="egyptianTurquoise_${uid}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#0f766e"/><stop offset="50%" stop-color="#2dd4bf"/><stop offset="100%" stop-color="#115e59"/>
      </linearGradient>
    </defs>
  `;

  let civOrnaments = '';
  if (skin.id === 'sumerian') {
    civOrnaments = `
      <circle cx="145" cy="50" r="5" fill="#1e3a8a" stroke="#fef08a" stroke-width="1.4"/>
      <circle cx="145" cy="50" r="2" fill="#2dd4bf"/>
      <path d="M175,44 L181,46 L175,48 M188,44 L194,46 L188,48 M202,46 L212,46" stroke="#fef08a" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    `;
  } else if (skin.id === 'egyptian') {
    civOrnaments = `
      <path d="M136,50 Q146,42 156,50 Q146,56 136,50 Z" fill="#09090b" stroke="#fef08a" stroke-width="1.3"/>
      <circle cx="146" cy="49.5" r="2.5" fill="#2dd4bf"/>
      <path d="M146,54 L146,59 L140,61" fill="none" stroke="#fef08a" stroke-width="1.3" stroke-linecap="round"/>
      <rect x="176" y="42" width="5" height="9" fill="#facc15"/>
      <rect x="190" y="42" width="5" height="9" fill="#2dd4bf"/>
    `;
  }

  let bodyHtml = '';

  if (weaponId === 'pistol') {
    const slideW = isSawed ? 92 : 132;
    const muzzleX = 112 + slideW;
    bodyHtml = `
      <path d="M95,52 L130,52 L118,90 C116,94 108,94 103,91 L88,86 Z" fill="${stockFill}" stroke="${skin.stockStroke}" stroke-width="2"/>
      <line x1="100" y1="62" x2="118" y2="62" stroke="${skin.receiverStroke}" stroke-width="1.5"/>
      <line x1="97" y1="71" x2="115" y2="71" stroke="${skin.receiverStroke}" stroke-width="1.5"/>
      <path d="M128,53 C128,68 148,68 150,53" fill="none" stroke="${skin.receiverStroke}" stroke-width="2.5"/>
      <path d="M137,54 L134,62" stroke="#d4d4d8" stroke-width="2" stroke-linecap="round"/>
      <rect x="110" y="44" width="${slideW - 8}" height="10" rx="2" fill="${receiverFill}" stroke="${skin.receiverStroke}" stroke-width="1.5"/>
      <rect x="108" y="30" width="${slideW}" height="16" rx="3" fill="${barrelFill}" stroke="${skin.barrelStroke}" stroke-width="1.8"/>
      <rect x="155" y="33" width="24" height="7" rx="1.5" fill="#09090b" stroke="${skin.receiverStroke}" stroke-width="1"/>
      <rect x="104" y="27" width="6" height="4" rx="1" fill="${pumpFill}"/>
      <circle cx="${muzzleX - 5}" cy="28" r="2.5" fill="${skin.sight}"/>
    `;
  } else if (weaponId === 'ak47') {
    const barrelW = isSawed ? 70 : 118;
    const muzzleX = 182 + barrelW;
    bodyHtml = `
      <path d="M14,50 L86,44 L90,62 L24,80 C17,82 12,76 12,68 Z" fill="${stockFill}" stroke="${skin.stockStroke}" stroke-width="2"/>
      <rect x="85" y="38" width="98" height="24" rx="3" fill="${receiverFill}" stroke="${skin.receiverStroke}" stroke-width="2"/>
      <path d="M102,62 L118,62 L111,86 L96,84 Z" fill="${stockFill}" stroke="${skin.stockStroke}" stroke-width="1.8"/>
      <path d="M136,62 L158,62 C162,76 168,88 178,94 L161,98 C150,89 142,76 136,62 Z" fill="${pumpFill}" stroke="${skin.barrelStroke}" stroke-width="1.8"/>
      <rect x="183" y="41" width="54" height="17" rx="2" fill="${pumpFill}" stroke="${skin.stockStroke}" stroke-width="1.5"/>
      <rect x="183" y="35" width="${barrelW - 18}" height="6" rx="1.5" fill="${receiverFill}" stroke="${skin.receiverStroke}" stroke-width="1.2"/>
      <rect x="183" y="44" width="${barrelW}" height="8" rx="1.5" fill="${barrelFill}" stroke="${skin.barrelStroke}" stroke-width="1.5"/>
      <polygon points="${muzzleX - 10},44 ${muzzleX - 10},34 ${muzzleX - 5},34 ${muzzleX - 5},44" fill="${skin.sight}"/>
    `;
  } else if (weaponId === 'bazooka') {
    const tubeW = isSawed ? 175 : 245;
    const tubeX = 35;
    bodyHtml = `
      <polygon points="18,32 36,38 36,62 18,68" fill="${pumpFill}" stroke="${skin.receiverStroke}" stroke-width="2"/>
      <rect x="${tubeX}" y="38" width="${tubeW}" height="24" rx="4" fill="${barrelFill}" stroke="${skin.barrelStroke}" stroke-width="2"/>
      <rect x="75" y="36" width="12" height="28" rx="2" fill="${receiverFill}" stroke="${skin.receiverStroke}" stroke-width="1.5"/>
      <rect x="155" y="36" width="12" height="28" rx="2" fill="${receiverFill}" stroke="${skin.receiverStroke}" stroke-width="1.5"/>
      <rect x="115" y="62" width="14" height="24" rx="2" fill="${stockFill}" stroke="${skin.stockStroke}" stroke-width="1.8"/>
      <rect x="142" y="62" width="12" height="20" rx="2" fill="${stockFill}" stroke="${skin.stockStroke}" stroke-width="1.5"/>
      <rect x="122" y="24" width="26" height="14" rx="2" fill="${receiverFill}" stroke="${skin.sight}" stroke-width="1.5"/>
      <path d="M${tubeX + tubeW},37 L${tubeX + tubeW + 24},50 L${tubeX + tubeW},63 Z" fill="${skin.sight}" stroke="${skin.barrelStroke}" stroke-width="1.5"/>
    `;
  } else if (weaponId === 'cannon') {
    const barrelLen = isSawed ? 125 : 185;
    bodyHtml = `
      <polygon points="65,30 ${65 + barrelLen},35 ${65 + barrelLen},61 65,66" fill="${barrelFill}" stroke="${skin.barrelStroke}" stroke-width="2.2"/>
      <circle cx="56" cy="48" r="10" fill="${receiverFill}" stroke="${skin.receiverStroke}" stroke-width="2"/>
      <rect x="95" y="29" width="8" height="38" rx="2" fill="${receiverFill}" stroke="${skin.receiverStroke}" stroke-width="1.5"/>
      <rect x="145" y="31" width="8" height="34" rx="2" fill="${receiverFill}" stroke="${skin.receiverStroke}" stroke-width="1.5"/>
      <rect x="${60 + barrelLen}" y="33" width="10" height="30" rx="2" fill="${pumpFill}" stroke="${skin.barrelStroke}" stroke-width="1.8"/>
      <path d="M52,64 L158,64 L145,84 L42,84 Z" fill="${stockFill}" stroke="${skin.stockStroke}" stroke-width="2"/>
      <circle cx="118" cy="74" r="18" fill="${pumpFill}" stroke="${skin.barrelStroke}" stroke-width="3"/>
      <circle cx="118" cy="74" r="6" fill="${skin.sight}"/>
      <line x1="100" y1="74" x2="136" y2="74" stroke="${skin.barrelStroke}" stroke-width="2"/>
      <line x1="118" y1="56" x2="118" y2="92" stroke="${skin.barrelStroke}" stroke-width="2"/>
    `;
  } else {
    const barrelW = isSawed ? 82 : 135;
    const magW = isSawed ? 76 : 122;
    const sightX = isSawed ? 243 : 296;
    bodyHtml = `
      <path d="M15,52 L85,45 L92,65 L28,82 C20,84 12,78 12,70 Z" fill="${stockFill}" stroke="${skin.stockStroke}" stroke-width="2"/>
      <path d="M12,55 L20,54 L20,80 L12,78 Z" fill="#18181b"/>
      <rect x="82" y="38" width="85" height="26" rx="4" fill="${receiverFill}" stroke="${skin.receiverStroke}" stroke-width="2"/>
      <rect x="115" y="42" width="28" height="9" rx="2" fill="#09090b" stroke="#71717a" stroke-width="1"/>
      <path d="M92,64 C92,76 112,76 112,64" fill="none" stroke="${skin.receiverStroke}" stroke-width="2.5"/>
      <path d="M102,64 L99,71" stroke="#d4d4d8" stroke-width="2" stroke-linecap="round"/>
      <rect x="167" y="40" width="${barrelW}" height="11" rx="2" fill="${barrelFill}" stroke="${skin.barrelStroke}" stroke-width="1.5"/>
      <rect x="167" y="53" width="${magW}" height="8" rx="2" fill="${receiverFill}" stroke="${skin.receiverStroke}" stroke-width="1.2"/>
      <rect x="182" y="50" width="54" height="15" rx="3" fill="${pumpFill}" stroke="${skin.stockStroke}" stroke-width="1.5"/>
      <line x1="192" y1="51" x2="192" y2="64" stroke="#18181b" stroke-width="2"/>
      <line x1="202" y1="51" x2="202" y2="64" stroke="#18181b" stroke-width="2"/>
      <line x1="212" y1="51" x2="212" y2="64" stroke="#18181b" stroke-width="2"/>
      <line x1="222" y1="51" x2="222" y2="64" stroke="#18181b" stroke-width="2"/>
      <circle cx="${sightX}" cy="38" r="2.5" fill="${skin.sight}"/>
    `;
  }

  return `
    <svg viewBox="0 0 320 100" class="${sizeClass} ${skin.glow}">
      ${defsHtml}
      ${bodyHtml}
      ${civOrnaments}
    </svg>
  `;
}

/**
 * 5. SERVER-AUTHORITATIVE STATE & PERSISTENT PROFILE
 */
const STORAGE_KEY = 'shawzen_online_profile_v4';

const AppState = {
  tickets: 5,
  wins: 0,
  matches: 0,
  streak: 0,
  unlockedWeapons: ['shotgun'],
  equippedWeapon: 'shotgun',
  unlockedSkins: ['classic'],
  equippedSkin: 'classic',
  armoryActiveTab: 'weapons',
  lastVictoryReward: 2,
  isDoubleOrNothingRun: false,

  currentMode: 'bot',
  roomCode: '',
  turnDuration: 30,
  maxRoomPlayers: 6,
  pendingRoomCreate: false,
  selectedBotCount: 1,
  lobbySeats: [],
  pendingAdRewardType: 'ticket',
  adTimerInterval: null,
  pendingTargetedItem: null,

  match: {
    active: false,
    round: 1,
    maxHp: 5,
    players: [],
    turnIndex: 0,
    selectedTargetId: null,
    chamber: [],
    timeLeft: 30,
    turnTimerInterval: null,
    doubleDamage: false,
    itemsUsedCount: 0,
    isBusy: false,
    bannerHoldUntil: 0,
    bannerQueueTimer: null,
    bleedingTargets: {}
  }
};

function loadProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (typeof data.tickets === 'number') AppState.tickets = data.tickets;
    if (typeof data.wins === 'number') AppState.wins = data.wins;
    if (typeof data.matches === 'number') AppState.matches = data.matches;
    if (typeof data.streak === 'number') AppState.streak = data.streak;
    if (Array.isArray(data.unlockedWeapons) && data.unlockedWeapons.length > 0) {
      AppState.unlockedWeapons = data.unlockedWeapons;
    }
    if (typeof data.equippedWeapon === 'string') {
      AppState.equippedWeapon = data.equippedWeapon;
    }
    if (Array.isArray(data.unlockedSkins) && data.unlockedSkins.length > 0) {
      AppState.unlockedSkins = data.unlockedSkins;
    }
    if (typeof data.equippedSkin === 'string') {
      AppState.equippedSkin = data.equippedSkin;
    }
  } catch (e) {}
}

function saveProfile() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tickets: AppState.tickets,
      wins: AppState.wins,
      matches: AppState.matches,
      streak: AppState.streak,
      unlockedWeapons: AppState.unlockedWeapons,
      equippedWeapon: AppState.equippedWeapon,
      unlockedSkins: AppState.unlockedSkins,
      equippedSkin: AppState.equippedSkin
    }));
  } catch (e) {}
}

function getWeaponMeta(weaponId) {
  return WEAPON_TYPES.find(w => w.id === weaponId) || WEAPON_TYPES[0];
}

function getSkinMeta(skinId) {
  return WEAPON_SKINS.find(s => s.id === skinId) || WEAPON_SKINS[0];
}

function updateTableActiveWeaponVisual() {
  const mount = document.getElementById('dynamicWeaponMount');
  const ownerBadge = document.getElementById('activeWeaponOwnerBadge');
  const m = AppState.match;

  let activePlayer = null;
  if (m.active && m.players.length > 0) {
    activePlayer = getCurrentTurnPlayer();
  }

  const wId = activePlayer ? activePlayer.weaponId : AppState.equippedWeapon;
  const sId = activePlayer ? activePlayer.skinId : AppState.equippedSkin;
  const wMeta = getWeaponMeta(wId);
  const sMeta = getSkinMeta(sId);

  if (mount) {
    mount.innerHTML = renderWeaponSVG(wId, sId, m.doubleDamage, 'w-full h-full');
  }

  if (ownerBadge && activePlayer) {
    const ownerLabel = activePlayer.isSelf ? 'سلاحك' : `سلاح ${activePlayer.name}`;
    ownerBadge.textContent = `${ownerLabel}: ${wMeta.name} • ${sMeta.name}`;
  }
}

function showFloatingHpChange(text, isDamage = true, position = 'center') {
  const el = document.getElementById('floatingHpIndicator');
  if (!el) return;
  el.textContent = text;
  el.className = isDamage
    ? 'hp-float-badge absolute z-30 pointer-events-none left-1/2 px-3.5 py-1 rounded-full font-black text-sm shadow-xl bg-red-600/95 border border-red-300 text-white'
    : 'hp-float-badge absolute z-30 pointer-events-none left-1/2 px-3.5 py-1 rounded-full font-black text-sm shadow-xl bg-emerald-600/95 border border-emerald-300 text-white';

  if (position === 'top') {
    el.style.top = '18%';
  } else if (position === 'bottom') {
    el.style.top = '72%';
  } else {
    el.style.top = '45%';
  }

  el.classList.remove('hidden');
  void el.offsetWidth;
  setTimeout(() => {
    el.classList.add('hidden');
  }, 1150);
}

function triggerBloodEffect(targetPlayer, damageAmount) {
  const m = AppState.match;
  const intensity = damageAmount >= 2 ? 2 : 1;
  m.bleedingTargets[targetPlayer.id] = {
    intensity,
    expiresAt: Date.now() + 1250
  };

  AudioEngine.bloodHit();

  if (targetPlayer.isSelf) {
    const vignette = document.getElementById('selfBloodVignette');
    if (vignette) {
      vignette.classList.remove('hidden', 'blood-overlay-active');
      void vignette.offsetWidth;
      vignette.classList.add('blood-overlay-active');
      setTimeout(() => vignette.classList.add('hidden'), 1180);
    }
  } else {
    renderGameUI();
    setTimeout(() => {
      delete m.bleedingTargets[targetPlayer.id];
      renderGameUI();
    }, 1250);
  }
}

function aimShotgunAtTarget(targetPlayer, recoilKick = false) {
  const gunEl = document.getElementById('shotgunContainer');
  if (!gunEl) return;

  if (!targetPlayer) {
    gunEl.style.transform = 'translate(0px, 0px) rotate(-15deg) scale(1)';
    return;
  }

  if (targetPlayer.isSelf) {
    const kickY = recoilKick ? -10 : 8;
    gunEl.style.transform = `translate(0px, ${kickY}px) rotate(90deg) scale(1.05)`;
    return;
  }

  const opps = AppState.match.players.filter(p => !p.isSelf);
  const oppIdx = opps.findIndex(p => p.id === targetPlayer.id);
  const cols = opps.length <= 2 ? Math.max(1, opps.length) : 3;
  const colIndex = oppIdx >= 0 ? (oppIdx % cols) : 1;
  const rowIndex = oppIdx >= 0 ? Math.floor(oppIdx / cols) : 0;

  let tx = 0;
  if (cols === 2) {
    tx = colIndex === 0 ? 52 : -52;
  } else if (cols === 3) {
    tx = colIndex === 0 ? 74 : (colIndex === 2 ? -74 : 0);
  }

  const ty = recoilKick ? 10 : -14 - (rowIndex * 4);
  const tiltAngle = -90 + (tx * 0.24);
  gunEl.style.transform = `translate(${tx}px, ${ty}px) rotate(${tiltAngle}deg) scale(1.05)`;
}

function resetShotgunAim() {
  const gunEl = document.getElementById('shotgunContainer');
  if (!gunEl) return;
  gunEl.style.transform = 'translate(0px, 0px) rotate(-15deg) scale(1)';
}

/**
 * 6. NAVIGATION, STATS & ARMORY (5 WEAPONS + 6 SKINS)
 */
function showScreen(screenId) {
  ['screen-menu', 'screen-lobby', 'screen-game'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(screenId);
  if (target) target.classList.remove('hidden');
}

function toggleModal(modalId, show) {
  const el = document.getElementById(modalId);
  if (!el) return;
  if (show) {
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function updateTicketsAndStatsUI() {
  const el = document.getElementById('ticketCount');
  if (el) el.textContent = AppState.tickets;

  const armoryEl = document.getElementById('armoryTicketDisplay');
  if (armoryEl) armoryEl.textContent = AppState.tickets;

  const wMeta = getWeaponMeta(AppState.equippedWeapon);
  const sMeta = getSkinMeta(AppState.equippedSkin);
  const menuBadge = document.getElementById('menuEquippedBadge');
  if (menuBadge) menuBadge.textContent = `${wMeta.name} • ${sMeta.name}`;

  const winsEl = document.getElementById('statMenuWins');
  const matchesEl = document.getElementById('statMenuMatches');
  const rateEl = document.getElementById('statMenuWinRate');
  const streakEl = document.getElementById('statMenuStreak');

  if (winsEl) winsEl.textContent = AppState.wins;
  if (matchesEl) matchesEl.textContent = AppState.matches;
  if (rateEl) {
    const pct = AppState.matches > 0 ? Math.round((AppState.wins / AppState.matches) * 100) : 0;
    rateEl.textContent = `${pct}%`;
  }
  if (streakEl) streakEl.textContent = `${AppState.streak} 🔥`;
}

function openArmoryModal(defaultTab = 'weapons') {
  AppState.armoryActiveTab = defaultTab;
  switchArmoryTab(defaultTab);
  toggleModal('armoryModal', true);
}

function switchArmoryTab(tab) {
  AppState.armoryActiveTab = tab;
  const tabW = document.getElementById('armoryTabWeapons');
  const tabS = document.getElementById('armoryTabSkins');
  if (tab === 'weapons') {
    tabW.className = 'py-2 rounded-xl bg-purple-600 text-white font-black text-xs transition cursor-pointer';
    tabS.className = 'py-2 rounded-xl bg-transparent text-zinc-400 hover:text-white font-bold text-xs transition cursor-pointer';
  } else {
    tabS.className = 'py-2 rounded-xl bg-purple-600 text-white font-black text-xs transition cursor-pointer';
    tabW.className = 'py-2 rounded-xl bg-transparent text-zinc-400 hover:text-white font-bold text-xs transition cursor-pointer';
  }
  renderArmoryContent();
}

function renderArmoryContent() {
  const container = document.getElementById('armoryContentContainer');
  const tEl = document.getElementById('armoryTicketDisplay');
  const previewStage = document.getElementById('armoryLivePreviewStage');
  const previewLabel = document.getElementById('armoryPreviewLabel');

  if (tEl) tEl.textContent = AppState.tickets;

  const curW = getWeaponMeta(AppState.equippedWeapon);
  const curS = getSkinMeta(AppState.equippedSkin);

  if (previewLabel) {
    previewLabel.textContent = `${curW.name} • ${curS.name}`;
  }
  if (previewStage) {
    previewStage.innerHTML = renderWeaponSVG(AppState.equippedWeapon, AppState.equippedSkin, false, 'w-full h-full');
  }

  if (!container) return;
  container.innerHTML = '';

  if (AppState.armoryActiveTab === 'weapons') {
    WEAPON_TYPES.forEach(w => {
      const isUnlocked = AppState.unlockedWeapons.includes(w.id);
      const isEquipped = AppState.equippedWeapon === w.id;

      const row = document.createElement('div');
      row.className = `p-2.5 rounded-2xl border flex items-center justify-between transition ${
        isEquipped
          ? 'bg-purple-950/35 border-purple-500 shadow-[0_0_12px_rgba(168,85,247,0.2)]'
          : 'bg-zinc-950 border-zinc-800'
      }`;

      let actionHtml = '';
      if (isEquipped) {
        actionHtml = `<span class="px-3 py-1.5 rounded-xl bg-purple-500/20 border border-purple-400 text-purple-300 text-[11px] font-black">مُجهّز ✓</span>`;
      } else if (isUnlocked) {
        actionHtml = `<button type="button" onclick="equipWeaponType('${w.id}')" class="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-[11px] font-black cursor-pointer">تجهيز</button>`;
      } else {
        const canAfford = AppState.tickets >= w.price;
        actionHtml = `<button type="button" onclick="buyWeaponType('${w.id}')" class="px-3 py-1.5 rounded-xl ${canAfford ? 'bg-amber-500 hover:bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-zinc-500'} text-[11px] font-black cursor-pointer">فتح ${w.price} 🎟️</button>`;
      }

      row.innerHTML = `
        <div class="flex items-center gap-2.5">
          <div class="w-16 h-10 rounded-xl bg-zinc-900 border border-zinc-700 flex items-center justify-center p-1">
            ${renderWeaponSVG(w.id, AppState.equippedSkin, false, 'w-full h-full')}
          </div>
          <div>
            <div class="text-xs font-black text-white">${w.name}</div>
            <div class="text-[10px] text-zinc-400">${w.badge}</div>
          </div>
        </div>
        <div>${actionHtml}</div>
      `;
      container.appendChild(row);
    });
  } else {
    WEAPON_SKINS.forEach(skin => {
      const isUnlocked = AppState.unlockedSkins.includes(skin.id);
      const isEquipped = AppState.equippedSkin === skin.id;
      const isCivilization = skin.id === 'sumerian' || skin.id === 'egyptian';

      const row = document.createElement('div');
      row.className = `p-2.5 rounded-2xl border flex items-center justify-between transition ${
        isEquipped
          ? 'bg-purple-950/35 border-purple-500 shadow-[0_0_12px_rgba(168,85,247,0.2)]'
          : isCivilization
            ? 'bg-gradient-to-l from-amber-950/25 via-zinc-950 to-zinc-950 border-amber-500/40'
            : 'bg-zinc-950 border-zinc-800'
      }`;

      let actionHtml = '';
      if (isEquipped) {
        actionHtml = `<span class="px-3 py-1.5 rounded-xl bg-purple-500/20 border border-purple-400 text-purple-300 text-[11px] font-black">مُجهّز ✓</span>`;
      } else if (isUnlocked) {
        actionHtml = `<button type="button" onclick="equipWeaponSkin('${skin.id}')" class="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-[11px] font-black cursor-pointer">تجهيز</button>`;
      } else {
        const canAfford = AppState.tickets >= skin.price;
        actionHtml = `<button type="button" onclick="buyWeaponSkin('${skin.id}')" class="px-3 py-1.5 rounded-xl ${canAfford ? 'bg-amber-500 hover:bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-zinc-500'} text-[11px] font-black cursor-pointer">فتح ${skin.price} 🎟️</button>`;
      }

      row.innerHTML = `
        <div class="flex items-center gap-2.5">
          <div class="w-16 h-10 rounded-xl bg-zinc-900 border ${isCivilization ? 'border-amber-500/50' : 'border-zinc-700'} flex items-center justify-center p-1">
            ${renderWeaponSVG(AppState.equippedWeapon, skin.id, false, 'w-full h-full')}
          </div>
          <div>
            <div class="text-xs font-black ${isCivilization ? 'text-amber-300' : 'text-white'}">${skin.name}</div>
            <div class="text-[10px] text-zinc-400">${skin.badge}</div>
          </div>
        </div>
        <div>${actionHtml}</div>
      `;
      container.appendChild(row);
    });
  }
}

function buyWeaponType(weaponId) {
  const w = WEAPON_TYPES.find(item => item.id === weaponId);
  if (!w || AppState.unlockedWeapons.includes(weaponId)) return;
  if (AppState.tickets < w.price) {
    toggleModal('armoryModal', false);
    openRewardModal('ticket');
    return;
  }
  AppState.tickets -= w.price;
  AppState.unlockedWeapons.push(weaponId);
  AppState.equippedWeapon = weaponId;
  saveProfile();
  updateTicketsAndStatsUI();
  updateTableActiveWeaponVisual();
  AudioEngine.healSound();
  renderArmoryContent();
}

function equipWeaponType(weaponId) {
  if (!AppState.unlockedWeapons.includes(weaponId)) return;
  AppState.equippedWeapon = weaponId;
  saveProfile();
  updateTicketsAndStatsUI();
  updateTableActiveWeaponVisual();
  AudioEngine.itemUse();
  renderArmoryContent();
}

function buyWeaponSkin(skinId) {
  const skin = WEAPON_SKINS.find(s => s.id === skinId);
  if (!skin || AppState.unlockedSkins.includes(skinId)) return;
  if (AppState.tickets < skin.price) {
    toggleModal('armoryModal', false);
    openRewardModal('ticket');
    return;
  }
  AppState.tickets -= skin.price;
  AppState.unlockedSkins.push(skinId);
  AppState.equippedSkin = skinId;
  saveProfile();
  updateTicketsAndStatsUI();
  updateTableActiveWeaponVisual();
  AudioEngine.healSound();
  renderArmoryContent();
}

function equipWeaponSkin(skinId) {
  if (!AppState.unlockedSkins.includes(skinId)) return;
  AppState.equippedSkin = skinId;
  saveProfile();
  updateTicketsAndStatsUI();
  updateTableActiveWeaponVisual();
  AudioEngine.itemUse();
  renderArmoryContent();
}

function toggleMute() {
  const muted = AudioEngine.toggleMute();
  const btn = document.getElementById('muteBtn');
  if (btn) btn.textContent = muted ? '🔇' : '🔊';
}

function leaveOnlineLobby() {
  if (socket && OnlineSession.connected && OnlineSession.roomId) {
    socket.emit('leave_room', { roomId: OnlineSession.roomId, code: OnlineSession.roomId });
  }
  AppState.pendingRoomCreate = false;
  OnlineSession.roomId = null;
  OnlineSession.isHost = false;
  OnlineSession.myPlayerId = null;
  OnlineSession.serverPlayers = [];
  OnlineSession.lobbyBots = [];
  backToMenu();
}

function backToMenu() {
  stopTurnTimer();
  if (AppState.match.bannerQueueTimer) {
    clearTimeout(AppState.match.bannerQueueTimer);
    AppState.match.bannerQueueTimer = null;
  }
  AppState.match.active = false;
  OnlineSession.isOnlineMatch = false;
  updateTicketsAndStatsUI();
  showScreen('screen-menu');
}

/**
 * 7. BOT SETUP & ONLINE LOBBY FLOW
 */
function generateBotLoadout(seedIndex) {
  const w = WEAPON_TYPES[(seedIndex + Math.floor(Math.random() * WEAPON_TYPES.length)) % WEAPON_TYPES.length];
  const s = WEAPON_SKINS[(seedIndex * 2 + Math.floor(Math.random() * WEAPON_SKINS.length)) % WEAPON_SKINS.length];
  return { weaponId: w.id, skinId: s.id };
}

function openBotSetupModal() {
  selectBotCount(AppState.selectedBotCount || 1);
  toggleModal('botSetupModal', true);
}

function selectBotCount(count) {
  AppState.selectedBotCount = count;
  for (let i = 1; i <= 5; i++) {
    const btn = document.getElementById(`botCountBtn-${i}`);
    if (!btn) continue;
    if (i === count) {
      btn.className = 'py-2.5 rounded-xl bg-emerald-500 text-zinc-950 font-black text-sm border border-emerald-400 cursor-pointer';
    } else {
      btn.className = 'py-2.5 rounded-xl bg-zinc-800 text-zinc-300 font-bold text-sm border border-zinc-700 hover:bg-zinc-700 cursor-pointer';
    }
  }
  const total = count + 1;
  const lbl = document.getElementById('botTotalPlayersLabel');
  if (lbl) lbl.textContent = `المجموع: ${total} لاعبين (أنت + ${count} ${count === 1 ? 'بوت' : 'بوتات'})`;
  AudioEngine.itemUse();
}

function confirmStartBotMatch() {
  toggleModal('botSetupModal', false);
  OnlineSession.isOnlineMatch = false;
  AppState.currentMode = 'bot';
  AppState.isDoubleOrNothingRun = false;
  const participants = [
    {
      id: 'player',
      name: 'أنت',
      avatar: '😎',
      isBot: false,
      isSelf: true,
      weaponId: AppState.equippedWeapon,
      skinId: AppState.equippedSkin
    }
  ];
  for (let i = 0; i < AppState.selectedBotCount; i++) {
    const loadout = generateBotLoadout(i + 1);
    participants.push({
      id: `bot_${i + 1}`,
      name: BOT_NAMES_POOL[i % BOT_NAMES_POOL.length],
      avatar: BOT_AVATARS[i % BOT_AVATARS.length],
      isBot: true,
      isSelf: false,
      weaponId: loadout.weaponId,
      skinId: loadout.skinId
    });
  }
  initMatch(participants);
}

function setRoomSyncStatus(text, isOk) {
  const pill = document.getElementById('roomSyncStatusPill');
  if (!pill) return;
  pill.textContent = text;
  pill.className = isOk
    ? 'px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[9px] font-bold'
    : 'px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[9px] font-bold animate-pulse';
}

function startQuickMatch() {
  if (!socket || !OnlineSession.connected) {
    alert('جاري الاتصال بالسيرفر الأونلاين، انتظر لحظة ثم أعد المحاولة أو العب ضد البوت.');
    return;
  }
  AppState.currentMode = 'quick';
  AppState.isDoubleOrNothingRun = false;
  selectTurnDuration(30);
  initLobbySeats();
  setupLobbyUI({
    badge: 'مطابقة عشوائية أونلاين',
    title: 'جاري البحث عن لاعبين على السيرفر...',
    subtitle: 'سيتم نقلك للساحة فور اكتمال المطابقة',
    showCodeBox: false,
    showHostSettings: false
  });
  showScreen('screen-lobby');

  socket.emit('quick_match', {
    name: 'Player',
    weapon: CLIENT_TO_SERVER_WEAPON[AppState.equippedWeapon] || AppState.equippedWeapon,
    skin: CLIENT_TO_SERVER_SKIN[AppState.equippedSkin] || AppState.equippedSkin
  });
}

function normalizeRoomCode(raw) {
  if (!raw) return '';
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  const easternDigits = '۰۱۲۳۴۵۶۷۸۹';
  let str = String(raw).trim();
  str = str.replace(/[٠-٩]/g, d => String(arabicDigits.indexOf(d)));
  str = str.replace(/[۰-۹]/g, d => String(easternDigits.indexOf(d)));
  str = str.replace(/\s+/g, '').toUpperCase();
  return str;
}

function updateDurationButtonsUI(seconds, canEdit) {
  AppState.turnDuration = seconds;
  const labelEl = document.getElementById('hostSettingsLabel');
  const guestNotice = document.getElementById('guestDurationNotice');
  const guestVal = document.getElementById('guestDurationValue');

  if (labelEl) {
    labelEl.textContent = canEdit
      ? '⚙️ إعدادات الغرفة الخاصة (تحكم المضيف):'
      : '⚙️ إعدادات الغرفة الخاصة (عرض فقط):';
  }
  if (guestNotice && guestVal) {
    guestVal.textContent = seconds;
    if (canEdit) {
      guestNotice.classList.add('hidden');
    } else {
      guestNotice.classList.remove('hidden');
    }
  }

  [30, 45, 60].forEach(sec => {
    const btn = document.getElementById(`durBtn-${sec}`);
    if (!btn) return;
    btn.disabled = !canEdit;
    if (sec === seconds) {
      btn.className = canEdit
        ? 'py-1.5 rounded-xl bg-amber-500 text-zinc-950 font-black text-xs border border-amber-400 transition cursor-pointer'
        : 'py-1.5 rounded-xl bg-amber-500/80 text-zinc-950 font-black text-xs border border-amber-400 cursor-default';
    } else {
      btn.className = canEdit
        ? 'py-1.5 rounded-xl bg-zinc-800 text-zinc-300 font-bold text-xs border border-zinc-700 hover:bg-zinc-700 transition cursor-pointer'
        : 'py-1.5 rounded-xl bg-zinc-900 text-zinc-500 font-bold text-xs border border-zinc-800 opacity-60 cursor-default';
    }
  });
}

function updateMaxPlayersButtonsUI(maxCount, canEdit) {
  AppState.maxRoomPlayers = maxCount;
  const guestMaxVal = document.getElementById('guestMaxPlayersValue');
  const lobbyMaxCountEl = document.getElementById('lobbyMaxPlayersCount');
  if (guestMaxVal) guestMaxVal.textContent = maxCount;
  if (lobbyMaxCountEl) lobbyMaxCountEl.textContent = maxCount;

  [2, 3, 4, 5, 6].forEach(num => {
    const btn = document.getElementById(`maxPBtn-${num}`);
    if (!btn) return;
    btn.disabled = !canEdit;
    if (num === maxCount) {
      btn.className = canEdit
        ? 'py-1 rounded-lg bg-amber-500 text-zinc-950 font-black text-[11px] border border-amber-400 transition cursor-pointer'
        : 'py-1 rounded-lg bg-amber-500/80 text-zinc-950 font-black text-[11px] border border-amber-400 cursor-default';
    } else {
      btn.className = canEdit
        ? 'py-1 rounded-lg bg-zinc-800 text-zinc-300 font-bold text-[11px] border border-zinc-700 hover:bg-zinc-700 transition cursor-pointer'
        : 'py-1 rounded-lg bg-zinc-900 text-zinc-500 font-bold text-[11px] border border-zinc-800 opacity-60 cursor-default';
    }
  });
}

function selectMaxRoomPlayers(maxCount) {
  if (OnlineSession.roomId && !OnlineSession.isHost) return;
  updateMaxPlayersButtonsUI(maxCount, true);
  if (OnlineSession.serverPlayers.length > 0) {
    rebuildCombinedLobbySeats();
  } else {
    while (AppState.lobbySeats.length > maxCount && AppState.lobbySeats[AppState.lobbySeats.length - 1].isBot) {
      AppState.lobbySeats.pop();
    }
    renderLobbySeats();
  }
  if (socket && OnlineSession.connected && OnlineSession.roomId && OnlineSession.isHost) {
    socket.emit('update_settings', {
      roomId: OnlineSession.roomId,
      code: OnlineSession.roomId,
      timerMax: AppState.turnDuration,
      maxPlayers: maxCount
    });
  }
  AudioEngine.itemUse();
}

function openCreateRoom() {
  AppState.currentMode = 'private';
  AppState.isDoubleOrNothingRun = false;
  OnlineSession.isHost = true;
  OnlineSession.myPlayerId = 0;
  OnlineSession.roomId = null;
  OnlineSession.serverPlayers = [];
  OnlineSession.lobbyBots = [];
  AppState.roomCode = '----';

  document.getElementById('generatedRoomCode').textContent = '----';
  document.getElementById('copyFeedback').textContent = '';

  initLobbySeats();
  setupLobbyUI({
    badge: `غرفة خاصة أونلاين (حتى ${AppState.maxRoomPlayers} لاعبين)`,
    title: 'غرفة التحدي الجماعي',
    subtitle: 'اضبط إعدادات الغرفة وشارك الرمز مع أصدقائك أو أضف بوتات',
    showCodeBox: true,
    showHostSettings: true
  });
  updateDurationButtonsUI(AppState.turnDuration, true);
  updateMaxPlayersButtonsUI(AppState.maxRoomPlayers, true);
  renderLobbySeats();
  showScreen('screen-lobby');
  AudioEngine.itemUse();

  if (socket && OnlineSession.connected) {
    AppState.pendingRoomCreate = false;
    setRoomSyncStatus('متصل بالسيرفر ✓', true);
    emitCreateRoomToServer();
  } else {
    AppState.pendingRoomCreate = true;
    setRoomSyncStatus('جاري الربط بالسيرفر...', false);
    if (socket && typeof socket.connect === 'function') {
      try { socket.connect(); } catch (e) {}
    }
  }
}

function initLobbySeats() {
  AppState.lobbySeats = [
    {
      id: 0,
      name: 'أنت (المضيف)',
      avatar: '😎',
      isBot: false,
      isSelf: true,
      weaponId: AppState.equippedWeapon,
      skinId: AppState.equippedSkin
    }
  ];
}

function renderLobbySeats() {
  const grid = document.getElementById('lobbySeatsGrid');
  const countEl = document.getElementById('lobbyPlayerCount');
  const maxCountEl = document.getElementById('lobbyMaxPlayersCount');
  if (!grid || !countEl) return;

  const maxSlots = AppState.maxRoomPlayers || 6;
  countEl.textContent = AppState.lobbySeats.length;
  if (maxCountEl) maxCountEl.textContent = maxSlots;
  grid.innerHTML = '';

  for (let i = 0; i < maxSlots; i++) {
    const seat = AppState.lobbySeats[i];
    const card = document.createElement('div');
    if (seat) {
      const wMeta = getWeaponMeta(seat.isSelf ? AppState.equippedWeapon : seat.weaponId);
      card.className = 'p-2 rounded-2xl bg-zinc-900 border border-emerald-500/50 text-center flex flex-col items-center justify-center';
      card.innerHTML = `
        <div class="text-xl mb-0.5">${seat.avatar}</div>
        <div class="text-[10px] font-extrabold text-white truncate w-full">${seat.name}</div>
        <div class="text-[8px] text-purple-300 font-bold truncate w-full">${wMeta.name}</div>
        <span class="mt-0.5 px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 text-[9px] font-bold">${seat.isBot ? 'بوت 🤖' : 'جاهز ✓'}</span>
      `;
    } else {
      card.className = 'p-2 rounded-2xl bg-zinc-950/60 border border-dashed border-zinc-700 text-center flex flex-col items-center justify-center min-h-[78px]';
      card.innerHTML = `
        <div class="text-base text-zinc-600">+</div>
        <div class="text-[9px] text-zinc-500 font-bold mt-0.5">مقعد شاغر</div>
      `;
    }
    grid.appendChild(card);
  }

  const botCtrl = document.getElementById('lobbyBotControls');
  if (botCtrl) {
    botCtrl.style.display = OnlineSession.isHost ? 'flex' : 'none';
  }

  const startBtn = document.getElementById('startLobbyMatchBtn');
  if (startBtn) {
    const canStart = AppState.lobbySeats.length >= 2 && OnlineSession.isHost;
    startBtn.disabled = !canStart;
    startBtn.textContent = OnlineSession.isHost
      ? (AppState.lobbySeats.length >= 2 ? 'بدء المواجهة الآن 🔥' : 'بانتظار انضمام لاعب أو إضافة بوت...')
      : 'بانتظار المضيف لبدء اللعبة...';
    startBtn.className = canStart
      ? 'btn-3d w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm'
      : 'w-full py-3 rounded-2xl bg-zinc-800 text-zinc-500 font-black text-sm cursor-not-allowed';
  }
}

function addLobbyBot() {
  if (!OnlineSession.isHost) return;
  const maxSlots = AppState.maxRoomPlayers || 6;
  if (AppState.lobbySeats.length >= maxSlots) return;

  const botIdx = OnlineSession.lobbyBots.length;
  const loadout = generateBotLoadout(botIdx + 1);
  OnlineSession.lobbyBots.push({
    id: `bot_${Date.now()}_${botIdx}`,
    name: BOT_NAMES_POOL[botIdx % BOT_NAMES_POOL.length],
    avatar: BOT_AVATARS[botIdx % BOT_AVATARS.length],
    isBot: true,
    isSelf: false,
    weaponId: loadout.weaponId,
    skinId: loadout.skinId
  });

  if (socket && OnlineSession.connected && OnlineSession.roomId) {
    socket.emit('add_bot', {
      code: OnlineSession.roomId,
      roomId: OnlineSession.roomId
    });
  }

  AudioEngine.itemUse();
  rebuildCombinedLobbySeats();
}

function removeLobbyBot() {
  if (!OnlineSession.isHost) return;
  if (OnlineSession.lobbyBots.length === 0) return;

  OnlineSession.lobbyBots.pop();

  if (socket && OnlineSession.connected && OnlineSession.roomId) {
    socket.emit('remove_bot', {
      code: OnlineSession.roomId,
      roomId: OnlineSession.roomId
    });
  }

  AudioEngine.blankClick();
  rebuildCombinedLobbySeats();
}

function startLobbyMatch() {
  if (AppState.lobbySeats.length < 2) return;

  if (socket && OnlineSession.connected && OnlineSession.roomId) {
    if (!OnlineSession.isHost) return;
    const desiredBotsCount = OnlineSession.lobbyBots.length;
    socket.emit('start_room_game', {
      code: OnlineSession.roomId,
      roomId: OnlineSession.roomId,
      fillBots: desiredBotsCount > 0,
      botCount: desiredBotsCount
    });
    return;
  }

  const seats = AppState.lobbySeats.map(s => s.isSelf ? {
    ...s,
    weaponId: AppState.equippedWeapon,
    skinId: AppState.equippedSkin
  } : s);
  initMatch(seats);
}

function selectTurnDuration(seconds) {
  if (OnlineSession.roomId && !OnlineSession.isHost) return;
  updateDurationButtonsUI(seconds, true);
  if (socket && OnlineSession.connected && OnlineSession.roomId && OnlineSession.isHost) {
    socket.emit('update_settings', {
      roomId: OnlineSession.roomId,
      code: OnlineSession.roomId,
      timerMax: seconds,
      maxPlayers: AppState.maxRoomPlayers
    });
  }
  AudioEngine.itemUse();
}

function openJoinRoom() {
  clearJoinPendingState();
  document.getElementById('joinCodeInput').value = '';
  document.getElementById('joinErrorText').textContent = '';
  toggleModal('joinRoomModal', true);
  setTimeout(() => {
    const inp = document.getElementById('joinCodeInput');
    if (inp) inp.focus();
  }, 60);
}

function submitJoinCode() {
  const rawVal = document.getElementById('joinCodeInput').value;
  const val = normalizeRoomCode(rawVal);
  const errEl = document.getElementById('joinErrorText');
  const btn = document.getElementById('submitJoinBtn');

  if (val.length < 3) {
    if (errEl) errEl.textContent = 'الرجاء إدخال رمز غرفة صحيح!';
    return;
  }

  AppState.currentMode = 'private';
  AppState.isDoubleOrNothingRun = false;
  OnlineSession.isHost = false;
  OnlineSession.myPlayerId = null;
  OnlineSession.roomId = val;
  OnlineSession.serverPlayers = [];
  OnlineSession.lobbyBots = [];
  AppState.roomCode = val;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'جاري الدخول...';
  }
  if (errEl) errEl.textContent = '';

  if (OnlineSession.joinTimeoutTimer) {
    clearTimeout(OnlineSession.joinTimeoutTimer);
  }
  OnlineSession.joinTimeoutTimer = setTimeout(() => {
    OnlineSession.joinTimeoutTimer = null;
    OnlineSession.pendingJoinCode = null;
    handleJoinFailure('انتهت مهلة الاتصال بالسيرفر (قد يكون السيرفر في وضع السكون، أعد المحاولة الآن)');
  }, 15000);

  if (!socket || !OnlineSession.connected) {
    if (errEl) errEl.textContent = 'جاري إيقاظ السيرفر والانضمام تلقائياً...';
    OnlineSession.pendingJoinCode = val;
    if (socket && typeof socket.connect === 'function') {
      try { socket.connect(); } catch (e) {}
    }
    return;
  }

  emitJoinRoomToServer(val);
}

function setupLobbyUI({ badge, title, subtitle, showCodeBox, showHostSettings }) {
  document.getElementById('lobbyBadge').textContent = badge;
  document.getElementById('lobbyTitle').textContent = title;
  document.getElementById('lobbySubtitle').textContent = subtitle;
  document.getElementById('roomCodeBox').style.display = showCodeBox ? 'block' : 'none';
  document.getElementById('hostSettingsBox').style.display = showHostSettings ? 'block' : 'none';
  renderLobbySeats();
}

function copyRoomCode() {
  const code = AppState.roomCode;
  if (!code || code === '----') return;
  const tempInput = document.createElement('input');
  tempInput.value = code;
  document.body.appendChild(tempInput);
  tempInput.select();
  try {
    document.execCommand('copy');
    document.getElementById('copyFeedback').textContent = 'تم نسخ رمز الغرفة بنجاح! ✓';
  } catch (e) {
    document.getElementById('copyFeedback').textContent = `الرمز: ${code}`;
  }
  document.body.removeChild(tempInput);
}

/**
 * 8. REWARDED VIDEO AD SYSTEM (+3 TICKETS OR FREE ITEM)
 */
function openRewardModal(type) {
  AppState.pendingAdRewardType = type;
  const claimBtn = document.getElementById('claimAdBtn');
  const bar = document.getElementById('adProgressBar');
  const timerTxt = document.getElementById('adTimerText');

  document.getElementById('adTitle').textContent = type === 'ticket'
    ? 'إعلان مكافأة التذاكر (+3 🎟️)'
    : 'إعلان أداة مساعدة إضافية (+1 🧰)';

  claimBtn.disabled = true;
  bar.style.width = '0%';
  let secondsLeft = 3;
  timerTxt.textContent = `${secondsLeft} ثوانٍ متبقية...`;
  toggleModal('rewardAdModal', true);

  if (AppState.adTimerInterval) clearInterval(AppState.adTimerInterval);
  let step = 0;
  AppState.adTimerInterval = setInterval(() => {
    step++;
    bar.style.width = `${Math.min(100, (step / 3) * 100)}%`;
    secondsLeft = Math.max(0, 3 - step);
    if (secondsLeft > 0) {
      timerTxt.textContent = `${secondsLeft} ثوانٍ متبقية...`;
    } else {
      clearInterval(AppState.adTimerInterval);
      timerTxt.textContent = 'اكتمل الإعلان! يمكنك استلام مكافأتك الآن';
      claimBtn.disabled = false;
    }
  }, 850);
}

function claimAdReward() {
  toggleModal('rewardAdModal', false);
  AudioEngine.healSound();

  if (AppState.pendingAdRewardType === 'ticket') {
    AppState.tickets += 3;
    saveProfile();
    updateTicketsAndStatsUI();
  } else if (AppState.pendingAdRewardType === 'item' && AppState.match.active) {
    if (OnlineSession.isOnlineMatch && socket && OnlineSession.connected) {
      socket.emit('claim_ad_item', { roomId: OnlineSession.roomId });
      return;
    }
    const me = getSelfPlayer();
    if (me && me.items.length < MAX_ITEM_SLOTS) {
      const randomKey = ITEM_KEYS[Math.floor(Math.random() * ITEM_KEYS.length)];
      me.items.push(randomKey);
      setActionBanner(`🎁 حصلت على أداة إضافية: ${ITEMS_DB[randomKey].name}!`, 'gold');
      renderGameUI();
    }
  }
}

/**
 * 9. CORE MULTIPLAYER MATCH & ROUND ENGINE
 */
function getSelfPlayer() {
  return AppState.match.players[0];
}

function getCurrentTurnPlayer() {
  return AppState.match.players[AppState.match.turnIndex];
}

function getAliveOpponents() {
  return AppState.match.players.filter(p => !p.isSelf && p.hp > 0);
}

function getAlivePlayers() {
  return AppState.match.players.filter(p => p.hp > 0);
}

function initMatch(participants) {
  const m = AppState.match;
  m.active = true;
  m.round = 1;
  m.maxHp = 5;
  m.bleedingTargets = {};
  m.bannerHoldUntil = 0;
  AppState.pendingTargetedItem = null;
  toggleModal('opponentPickerModal', false);

  m.players = participants.map((p, idx) => {
    const fallbackLoadout = generateBotLoadout(idx);
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isBot: p.isBot,
      isSelf: p.isSelf,
      weaponId: p.isSelf ? AppState.equippedWeapon : (p.weaponId || fallbackLoadout.weaponId),
      skinId: p.isSelf ? AppState.equippedSkin : (p.skinId || fallbackLoadout.skinId),
      hp: 5,
      maxHp: 5,
      eliminated: false,
      cuffed: false,
      hasShield: false,
      pillowTurns: 0,
      items: []
    };
  });
  m.turnIndex = 0;
  m.selectedTargetId = m.players[1] ? m.players[1].id : null;
  m.doubleDamage = false;
  m.itemsUsedCount = 0;
  m.isBusy = false;

  resetShotgunAim();
  updateShotgunBarrelVisual(false);
  showScreen('screen-game');
  startNewRound();
}

function startNewRound() {
  const m = AppState.match;
  m.isBusy = true;
  stopTurnTimer();
  m.doubleDamage = false;
  m.bleedingTargets = {};
  m.players.forEach(p => { p.cuffed = false; });
  resetShotgunAim();
  updateShotgunBarrelVisual(false);

  const aliveCount = getAlivePlayers().length;
  const baseLive = Math.min(5, Math.max(1, Math.floor(aliveCount * 0.7) + Math.floor(m.round / 2)));
  const baseBlank = Math.min(5, Math.max(2, aliveCount + (m.round % 2)));
  const itemsPerRound = 2;

  const unshuffled = [];
  for (let i = 0; i < baseLive; i++) unshuffled.push('live');
  for (let i = 0; i < baseBlank; i++) unshuffled.push('blank');

  const shuffled = [...unshuffled];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  m.chamber = shuffled;

  getAlivePlayers().forEach(p => {
    for (let i = 0; i < itemsPerRound; i++) {
      if (p.items.length < MAX_ITEM_SLOTS) {
        p.items.push(ITEM_KEYS[Math.floor(Math.random() * ITEM_KEYS.length)]);
      }
    }
  });

  document.getElementById('modalRoundNum').textContent = m.round;
  document.getElementById('revealLiveCount').textContent = baseLive;
  document.getElementById('revealBlankCount').textContent = baseBlank;

  const listEl = document.getElementById('revealShellsList');
  listEl.innerHTML = '';
  unshuffled.forEach(type => {
    const shellWrap = document.createElement('div');
    shellWrap.className = 'flex flex-col items-center gap-1 bg-zinc-900/90 px-2.5 py-2 rounded-2xl border ' +
      (type === 'live' ? 'border-red-500/40' : 'border-sky-500/40');
    shellWrap.innerHTML = `
      ${createShellSVG(type, 'w-7 h-12')}
      <span class="text-[10px] font-black ${type === 'live' ? 'text-red-400' : 'text-sky-300'}">${type === 'live' ? 'حية' : 'فارغة'}</span>
    `;
    listEl.appendChild(shellWrap);
  });

  toggleModal('roundRevealOverlay', true);
  ensureValidSelectedTarget();
  renderGameUI();

  setTimeout(() => {
    toggleModal('roundRevealOverlay', false);
    AudioEngine.rack();
    m.isBusy = false;
    if (getCurrentTurnPlayer().hp <= 0) {
      advanceTurnIndex();
    }
    const activeP = getCurrentTurnPlayer();
    if (activeP.isSelf) {
      setActionBanner('دورك الآن! اختر خصماً أو أداة للعب 🎯', 'neutral', true);
      const targetObj = m.players.find(p => p.id === m.selectedTargetId);
      aimShotgunAtTarget(targetObj, false);
    } else {
      setActionBanner(`دور ${activeP.name} الآن...`, 'neutral', true);
    }
    startTurnTimer();
    renderGameUI();
    if (!activeP.isSelf) {
      setTimeout(runOpponentAI, 850);
    }
  }, 2200);
}

function ensureValidSelectedTarget() {
  const m = AppState.match;
  const aliveOpps = getAliveOpponents();
  if (aliveOpps.length === 0) {
    m.selectedTargetId = null;
    return;
  }
  const stillAlive = aliveOpps.find(o => o.id === m.selectedTargetId);
  if (!stillAlive) {
    m.selectedTargetId = aliveOpps[0].id;
  }
}

function selectOpponentTarget(oppId) {
  const m = AppState.match;
  const opp = m.players.find(p => p.id === oppId && !p.isSelf && p.hp > 0);
  if (!opp) return;
  m.selectedTargetId = opp.id;
  AudioEngine.blankClick();
  if (getCurrentTurnPlayer() && getCurrentTurnPlayer().isSelf && !m.isBusy) {
    aimShotgunAtTarget(opp, false);
  }
  renderGameUI();
}

function tickPlayerPillowOnTurnEnd(player) {
  if (!player || player.pillowTurns <= 0) return;
  player.pillowTurns--;
  if (player.pillowTurns <= 0) {
    player.pillowTurns = 0;
    if (player.isSelf) {
      setActionBanner('🛏️ انتهت مدة وسادتك السرية (مرّ دوران).', 'neutral', false);
    }
  }
}

function advanceTurnIndex() {
  const m = AppState.match;
  const endingPlayer = getCurrentTurnPlayer();
  tickPlayerPillowOnTurnEnd(endingPlayer);

  const total = m.players.length;
  for (let step = 1; step <= total; step++) {
    const nextIdx = (m.turnIndex + step) % total;
    const candidate = m.players[nextIdx];
    if (candidate.hp <= 0) continue;
    if (candidate.cuffed) {
      candidate.cuffed = false;
      setActionBanner(`⛓️ ${candidate.name} مقيد وتخطى دوره!`, 'gold', true);
      tickPlayerPillowOnTurnEnd(candidate);
      continue;
    }
    m.turnIndex = nextIdx;
    return;
  }
}

function startTurnTimer() {
  if (OnlineSession.isOnlineMatch) return;
  const m = AppState.match;
  stopTurnTimer();
  m.timeLeft = AppState.turnDuration;
  updateTimerDisplay();

  m.turnTimerInterval = setInterval(() => {
    if (!m.active || m.isBusy) return;
    m.timeLeft--;
    updateTimerDisplay();

    if (m.timeLeft <= 0) {
      stopTurnTimer();
      handleTurnTimeout();
    }
  }, 1000);
}

function stopTurnTimer() {
  if (AppState.match.turnTimerInterval) {
    clearInterval(AppState.match.turnTimerInterval);
    AppState.match.turnTimerInterval = null;
  }
}

function updateTimerDisplay() {
  const el = document.getElementById('turnTimerDisplay');
  const box = document.getElementById('turnTimerBox');
  if (!el || !box) return;
  const t = AppState.match.timeLeft;
  el.textContent = `${t}s`;
  if (t <= 10) {
    el.className = 'text-[11px] font-mono font-black text-red-400 animate-pulse';
    box.className = 'px-2 py-0.5 rounded-lg bg-red-950/60 border border-red-500/60 flex items-center gap-1';
  } else {
    el.className = 'text-[11px] font-mono font-black text-emerald-400';
    box.className = 'px-2 py-0.5 rounded-lg bg-zinc-950 border border-zinc-700 flex items-center gap-1';
  }
}

function handleTurnTimeout() {
  const m = AppState.match;
  if (!m.active || m.isBusy || OnlineSession.isOnlineMatch) return;
  toggleModal('opponentPickerModal', false);
  AppState.pendingTargetedItem = null;
  const activeP = getCurrentTurnPlayer();
  if (activeP.isSelf) {
    ensureValidSelectedTarget();
    setActionBanner('⌛ انتهى وقت دورك! تم الإطلاق تلقائياً...', 'danger', true);
    executeShot(activeP.id, m.selectedTargetId);
  } else {
    const targets = getAlivePlayers().filter(p => p.id !== activeP.id);
    const randomTarget = targets[Math.floor(Math.random() * targets.length)];
    setActionBanner(`⌛ انتهى وقت ${activeP.name}!`, 'gold', true);
    executeShot(activeP.id, randomTarget.id);
  }
}

function setActionBanner(text, highlight = 'neutral', immediate = false) {
  const m = AppState.match;
  const MIN_NOTICE_HOLD_MS = 360;

  const applyText = () => {
    const el = document.getElementById('actionBanner');
    if (!el) return;
    el.textContent = text;
    el.className = 'w-full text-center py-1.5 px-2.5 rounded-xl text-[11px] font-bold z-10 shadow-md transition-colors ';
    if (highlight === 'danger') {
      el.className += 'bg-red-950/90 border border-red-500/60 text-red-200';
    } else if (highlight === 'safe') {
      el.className += 'bg-sky-950/90 border border-sky-500/60 text-sky-200';
    } else if (highlight === 'gold') {
      el.className += 'bg-amber-950/90 border border-amber-500/60 text-amber-200';
    } else {
      el.className += 'bg-zinc-900/90 border border-zinc-700/70 text-zinc-200';
    }
    m.bannerHoldUntil = Date.now() + MIN_NOTICE_HOLD_MS;
  };

  if (m.bannerQueueTimer) {
    clearTimeout(m.bannerQueueTimer);
    m.bannerQueueTimer = null;
  }

  const waitMs = immediate ? 0 : Math.max(0, m.bannerHoldUntil - Date.now());
  if (waitMs === 0) {
    applyText();
  } else {
    m.bannerQueueTimer = setTimeout(() => {
      m.bannerQueueTimer = null;
      applyText();
    }, waitMs);
  }
}

function updateShotgunBarrelVisual(isSawed) {
  const badge = document.getElementById('doubleDamageBadge');
  if (isSawed) {
    badge.classList.remove('hidden');
    badge.classList.add('flex');
  } else {
    badge.classList.add('hidden');
    badge.classList.remove('flex');
  }
  updateTableActiveWeaponVisual();
}

function renderGameUI() {
  const m = AppState.match;
  const me = getSelfPlayer();
  if (!me) return;
  const activeP = getCurrentTurnPlayer();
  ensureValidSelectedTarget();
  updateTableActiveWeaponVisual();

  document.getElementById('roundNumberDisplay').textContent = m.round;
  document.getElementById('remainingShellsCount').textContent = m.chamber.length;

  const pipsEl = document.getElementById('shellsVisualPips');
  if (pipsEl) {
    pipsEl.innerHTML = '';
    for (let s = 0; s < m.chamber.length; s++) {
      const pip = document.createElement('span');
      pip.className = 'w-1.5 h-3 rounded-sm bg-amber-400/85 inline-block';
      pipsEl.appendChild(pip);
    }
  }

  renderHearts('playerHearts', me.hp, me.maxHp || m.maxHp);
  const pHpNum = document.getElementById('playerHpNumeric');
  if (pHpNum) pHpNum.textContent = `(${me.hp}/${me.maxHp || m.maxHp})`;

  const pCuffEl = document.getElementById('playerCuffedBadge');
  if (me.cuffed) pCuffEl.classList.remove('hidden');
  else pCuffEl.classList.add('hidden');

  const pShieldEl = document.getElementById('playerShieldBadge');
  if (me.hasShield) pShieldEl.classList.remove('hidden');
  else pShieldEl.classList.add('hidden');

  const pPillowEl = document.getElementById('playerPillowBadge');
  if (me.pillowTurns > 0) {
    pPillowEl.textContent = `🛏️ وسادة سرية (${me.pillowTurns})`;
    pPillowEl.classList.remove('hidden');
  } else {
    pPillowEl.classList.add('hidden');
  }

  const oppsGrid = document.getElementById('opponentsGridContainer');
  const opponents = m.players.filter(p => !p.isSelf);
  oppsGrid.className = opponents.length <= 2
    ? `grid grid-cols-${Math.max(1, opponents.length)} gap-1.5`
    : 'grid grid-cols-3 gap-1.5';
  oppsGrid.innerHTML = '';

  opponents.forEach(opp => {
    const isDead = opp.hp <= 0 || opp.eliminated;
    const isTurn = (activeP && activeP.id === opp.id && !isDead);
    const isTarget = (m.selectedTargetId === opp.id && !isDead);
    const bleedInfo = m.bleedingTargets[opp.id];
    const isBleeding = Boolean(bleedInfo && bleedInfo.expiresAt > Date.now());
    const oppWeaponMeta = getWeaponMeta(opp.weaponId);
    const oppSkinMeta = getSkinMeta(opp.skinId);

    const card = document.createElement('div');
    card.onclick = () => { if (!isDead) selectOpponentTarget(opp.id); };

    let borderClass = 'border-zinc-800 bg-zinc-950/70';
    if (isDead) {
      borderClass = 'border-zinc-900 bg-zinc-950/40 opacity-45 grayscale';
    } else if (isBleeding) {
      borderClass = 'border-red-500 bg-red-950/60 shadow-[0_0_16px_rgba(220,38,38,0.65)]';
    } else if (isTurn) {
      borderClass = 'border-amber-400 bg-amber-950/25 shadow-[0_0_12px_rgba(251,191,36,0.25)]';
    } else if (isTarget) {
      borderClass = 'border-red-500 bg-red-950/25';
    }

    card.className = `relative overflow-hidden rounded-xl p-1.5 border transition cursor-pointer select-none ${borderClass}`;

    const oppMaxHp = opp.maxHp || m.maxHp || 5;
    let heartsHtml = '';
    for (let h = 0; h < oppMaxHp; h++) {
      heartsHtml += h < opp.hp
        ? '<span class="text-[8px] leading-none text-red-500">❤️</span>'
        : '<span class="text-[8px] leading-none opacity-35">🖤</span>';
    }

    let activeStatusHtml = '';
    if (isDead) {
      activeStatusHtml = '<span class="text-[9px] text-zinc-500 font-bold">مُقصى 💀</span>';
    } else if (opp.hasShield) {
      activeStatusHtml = '<span class="text-[9px] bg-sky-500/25 text-sky-300 px-1 rounded font-black" title="محمي بدرع">🛡️</span>';
    }

    const bloodDripsHtml = isBleeding ? `
      <div class="pointer-events-none absolute inset-0 z-20 overflow-hidden">
        <div class="absolute inset-x-0 top-0 h-3 bg-gradient-to-b from-red-600/85 to-transparent"></div>
        <span class="blood-drip-drop absolute top-0.5 right-2 w-1.5 h-3.5 rounded-full bg-red-600 shadow-[0_0_4px_#dc2626]"></span>
        <span class="blood-drip-drop absolute top-0.5 left-1/2 w-1.5 h-4 rounded-full bg-red-500" style="animation-delay: 0.12s;"></span>
        <span class="blood-drip-drop absolute top-0.5 left-2.5 w-1.5 h-3 rounded-full bg-red-700" style="animation-delay: 0.22s;"></span>
        ${bleedInfo.intensity >= 2 ? `
          <span class="blood-drip-drop absolute top-1 right-1/3 w-2 h-4 rounded-full bg-red-500" style="animation-delay: 0.08s;"></span>
          <span class="blood-drip-drop absolute top-1 left-1/3 w-2 h-4 rounded-full bg-red-600" style="animation-delay: 0.18s;"></span>
        ` : ''}
      </div>
    ` : '';

    card.innerHTML = `
      ${bloodDripsHtml}
      <div class="flex items-center justify-between gap-1 relative z-10">
        <div class="flex items-center gap-1 min-w-0">
          <span class="text-xs leading-none">${isDead ? '💀' : opp.avatar}</span>
          <span class="text-[10px] font-extrabold text-white truncate">${opp.name}</span>
        </div>
        <div class="flex items-center gap-0.5">
          ${isTarget && !isDead ? '<span class="text-[10px] leading-none">🎯</span>' : ''}
          ${opp.cuffed && !isDead ? '<span class="text-[9px] bg-amber-500 text-zinc-950 px-1 rounded font-black">⛓️</span>' : ''}
        </div>
      </div>
      <div class="text-[8px] font-bold text-purple-300/90 truncate mt-0.5 relative z-10">
        ${oppWeaponMeta.name} • ${oppSkinMeta.name.split(' ')[0]}
      </div>
      <div class="flex items-center justify-between mt-0.5 gap-1 relative z-10">
        <div class="flex items-center gap-[1px]">${heartsHtml}</div>
        <div class="flex items-center gap-0.5">${activeStatusHtml}</div>
      </div>
      ${isTurn ? '<div class="absolute -top-1.5 left-1.5 px-1.5 rounded bg-amber-500 text-zinc-950 text-[8px] font-black z-20">دوره</div>' : ''}
    `;
    oppsGrid.appendChild(card);
  });

  const selectedOpp = m.players.find(p => p.id === m.selectedTargetId);
  const targetLabelEl = document.getElementById('selectedTargetLabel');
  const shootOppBtnText = document.getElementById('btnShootOpponentText');
  if (selectedOpp) {
    targetLabelEl.textContent = `الهدف المحدد: ${selectedOpp.name} 🎯`;
    shootOppBtnText.textContent = `أطلق على ${selectedOpp.name}`;
  } else {
    targetLabelEl.textContent = 'اختر هدفاً';
    shootOppBtnText.textContent = 'أطلق على الخصم';
  }

  const isPlayerTurn = (activeP && activeP.isSelf && !m.isBusy);
  document.getElementById('btnShootOpponent').disabled = !isPlayerTurn || !selectedOpp;
  document.getElementById('btnShootSelf').disabled = !isPlayerTurn;

  const pTurnInd = document.getElementById('playerTurnIndicator');
  if (activeP && activeP.isSelf) {
    pTurnInd.textContent = 'دورك للعب ●';
    pTurnInd.className = 'text-[10px] font-black text-emerald-400';
  } else if (activeP) {
    pTurnInd.textContent = `دور ${activeP.name}...`;
    pTurnInd.className = 'text-[10px] font-bold text-amber-400';
  }

  const slotCountEl = document.getElementById('playerItemSlotCount');
  if (slotCountEl) slotCountEl.textContent = me.items.length;

  const pItemsEl = document.getElementById('playerItemsContainer');
  pItemsEl.innerHTML = '';
  for (let i = 0; i < MAX_ITEM_SLOTS; i++) {
    const key = me.items[i];
    const btn = document.createElement('button');
    btn.type = 'button';
    if (key && ITEMS_DB[key]) {
      const item = ITEMS_DB[key];
      btn.disabled = !isPlayerTurn;
      btn.className = 'relative flex flex-col items-center justify-center p-1 rounded-xl bg-zinc-900 hover:bg-zinc-800 active:scale-95 disabled:opacity-50 border border-zinc-700 hover:border-amber-500/60 transition select-none cursor-pointer';
      btn.innerHTML = `
        <span class="text-sm leading-none pointer-events-none">${item.icon}</span>
        <span class="text-[8px] font-bold text-zinc-300 mt-0.5 truncate w-full text-center pointer-events-none">${item.name.split(' ')[0]}</span>
      `;

      let pressTimer = null;
      let longPressTriggered = false;

      const startPress = () => {
        longPressTriggered = false;
        pressTimer = setTimeout(() => {
          longPressTriggered = true;
          showItemTooltip(item);
        }, 500);
      };

      const cancelPress = () => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
      };

      btn.addEventListener('pointerdown', startPress);
      btn.addEventListener('pointerup', cancelPress);
      btn.addEventListener('pointerleave', cancelPress);
      btn.addEventListener('pointercancel', cancelPress);
      btn.addEventListener('contextmenu', e => e.preventDefault());

      btn.onclick = () => {
        if (longPressTriggered) {
          longPressTriggered = false;
          return;
        }
        usePlayerItem(i);
      };
    } else {
      btn.disabled = true;
      btn.className = 'rounded-xl bg-zinc-950/50 border border-dashed border-zinc-800/80 flex items-center justify-center text-zinc-700 text-xs';
      btn.textContent = '•';
    }
    pItemsEl.appendChild(btn);
  }

  document.getElementById('inGameAdItemBtn').style.display =
    (me.items.length < MAX_ITEM_SLOTS && isPlayerTurn) ? 'flex' : 'none';
}

function showItemTooltip(item) {
  AudioEngine.itemUse();
  document.getElementById('tooltipItemIcon').textContent = item.icon;
  document.getElementById('tooltipItemName').textContent = item.name;
  document.getElementById('tooltipItemDesc').textContent = item.desc;
  toggleModal('itemTooltipModal', true);
}

function renderHearts(containerId, currentHp, maxHp) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < maxHp; i++) {
    const span = document.createElement('span');
    if (i < currentHp) {
      span.className = 'text-xs text-red-500 drop-shadow-[0_0_6px_rgba(239,68,68,0.65)] transition-transform duration-200 scale-100';
      span.textContent = '❤️';
    } else {
      span.className = 'text-xs opacity-35 transition-transform duration-200 scale-90';
      span.textContent = '🖤';
    }
    container.appendChild(span);
  }
}

/**
 * 10. PLAYER & TARGETED ITEM USAGE LOGIC
 */
function checkAndConsumeShield(attacker, defender, itemName) {
  if (!defender.hasShield) return false;
  defender.hasShield = false;
  AudioEngine.shieldBlock();
  setActionBanner(`🛡️ درع ${defender.name} تصدّى لـ (${itemName}) من ${attacker.name} وتحطّم الدرع!`, 'safe', true);
  return true;
}

function openOpponentPickerForItem(itemType, slotIndex) {
  const aliveOpps = getAliveOpponents();
  if (aliveOpps.length === 0) return;

  AppState.pendingTargetedItem = { type: itemType, slotIndex, selectedOppId: null };
  renderOpponentPickerStep1();
  toggleModal('opponentPickerModal', true);
}

function renderOpponentPickerStep1() {
  const pending = AppState.pendingTargetedItem;
  if (!pending) return;

  const aliveOpps = getAliveOpponents();
  const isThief = pending.type === 'thief';
  const itemMeta = ITEMS_DB[pending.type];

  document.getElementById('pickerModalIcon').textContent = itemMeta.icon;
  document.getElementById('pickerModalTitle').textContent = isThief
    ? 'السارق 🦝 — اختر خصماً لكشف أدواته'
    : 'المبادل 🔄 — اختر خصماً لتبديل الأدوات';
  document.getElementById('pickerModalSubtitle').textContent = isThief
    ? 'يظهر هنا عدد أدوات كل خصم؛ انقر لاختيار خصم وكشف أدواته'
    : 'ستتبادل جميع أدواتك الحالية مع جميع أدواته';

  const listEl = document.getElementById('pickerOpponentsList');
  const itemsBoxEl = document.getElementById('pickerOpponentItemsBox');
  const backBtnEl = document.getElementById('pickerBackBtn');

  listEl.classList.remove('hidden');
  itemsBoxEl.classList.add('hidden');
  backBtnEl.classList.add('hidden');
  listEl.innerHTML = '';

  aliveOpps.forEach(opp => {
    const oppItemCount = OnlineSession.isOnlineMatch
      ? (typeof opp.itemsCount === 'number' ? opp.itemsCount : opp.items.length)
      : opp.items.length;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'w-full p-3 rounded-2xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-700 hover:border-amber-500/60 flex items-center justify-between transition cursor-pointer';

    const countBadgeHtml = isThief
      ? `<span class="px-2 py-0.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-black">🧰 ${oppItemCount}/7</span>`
      : '';

    btn.innerHTML = `
      <div class="flex items-center gap-2.5">
        <span class="text-xl">${opp.avatar}</span>
        <div class="text-right">
          <div class="text-xs font-black text-white">${opp.name}</div>
          <div class="text-[10px] text-zinc-400">الصحة: ${opp.hp}/${opp.maxHp} ❤️</div>
        </div>
      </div>
      <div class="flex items-center gap-1.5">
        ${countBadgeHtml}
        ${opp.hasShield ? '<span class="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 text-[10px] font-bold">🛡️</span>' : ''}
        <span class="px-2.5 py-1 rounded-xl bg-amber-500 text-zinc-950 text-[11px] font-black">${isThief ? 'كشف' : 'تبديل'}</span>
      </div>
    `;
    btn.onclick = () => {
      if (isThief) {
        handleThiefSelectOpponent(opp.id);
      } else {
        executeSwapperOnOpponent(opp.id);
      }
    };
    listEl.appendChild(btn);
  });
}

function backToThiefOpponentStep() {
  renderOpponentPickerStep1();
}

function handleThiefSelectOpponent(targetOppId) {
  const pending = AppState.pendingTargetedItem;
  if (!pending || pending.type !== 'thief') return;

  const m = AppState.match;
  const me = getSelfPlayer();
  const targetOpp = m.players.find(p => p.id === targetOppId);
  if (!targetOpp || targetOpp.hp <= 0) return;

  if (OnlineSession.isOnlineMatch && socket && OnlineSession.connected) {
    socket.emit('thief_inspect', {
      targetId: targetOpp.id
    });
    return;
  }

  if (targetOpp.hasShield) {
    toggleModal('opponentPickerModal', false);
    AppState.pendingTargetedItem = null;
    if (me.items[pending.slotIndex] === 'thief') {
      me.items.splice(pending.slotIndex, 1);
      m.itemsUsedCount++;
    }
    checkAndConsumeShield(me, targetOpp, 'السارق 🦝');
    renderGameUI();
    return;
  }

  if (targetOpp.items.length === 0) {
    AudioEngine.blankClick();
    document.getElementById('pickerModalSubtitle').textContent = `⚠️ مخزون ${targetOpp.name} فارغ تماماً! اختر خصماً آخر.`;
    return;
  }

  pending.selectedOppId = targetOpp.id;
  AudioEngine.itemUse();

  document.getElementById('pickerModalTitle').textContent = `أدوات ${targetOpp.name} المكشوفة`;
  document.getElementById('pickerModalSubtitle').textContent = 'اختر الأداة التي تريد سرقتها وإضافتها لخاناتك:';

  const listEl = document.getElementById('pickerOpponentsList');
  const itemsBoxEl = document.getElementById('pickerOpponentItemsBox');
  const itemsGridEl = document.getElementById('pickerOpponentItemsGrid');
  const backBtnEl = document.getElementById('pickerBackBtn');

  listEl.classList.add('hidden');
  itemsBoxEl.classList.remove('hidden');
  backBtnEl.classList.remove('hidden');
  itemsGridEl.innerHTML = '';

  targetOpp.items.forEach((oppItemKey, oppItemIdx) => {
    const itemInfo = ITEMS_DB[oppItemKey];
    if (!itemInfo) return;
    const itemBtn = document.createElement('button');
    itemBtn.type = 'button';
    itemBtn.className = 'p-2.5 rounded-2xl bg-zinc-950 hover:bg-amber-500/20 border border-zinc-700 hover:border-amber-400 flex flex-col items-center justify-center gap-1 transition cursor-pointer';
    itemBtn.innerHTML = `
      <span class="text-2xl">${itemInfo.icon}</span>
      <span class="text-[10px] font-black text-white text-center leading-tight">${itemInfo.name}</span>
    `;
    itemBtn.onclick = () => confirmThiefStealSpecificItem(targetOpp.id, oppItemIdx);
    itemsGridEl.appendChild(itemBtn);
  });
}

function confirmThiefStealSpecificItem(targetOppId, oppItemIdx) {
  const pending = AppState.pendingTargetedItem;
  toggleModal('opponentPickerModal', false);
  AppState.pendingTargetedItem = null;
  if (!pending || pending.type !== 'thief') return;

  const m = AppState.match;
  const me = getSelfPlayer();
  const targetOpp = m.players.find(p => p.id === targetOppId);
  if (!targetOpp || targetOpp.hp <= 0) return;
  if (me.items[pending.slotIndex] !== 'thief') return;

  me.items.splice(pending.slotIndex, 1);
  m.itemsUsedCount++;

  if (oppItemIdx < 0 || oppItemIdx >= targetOpp.items.length) return;
  const stolenKey = targetOpp.items.splice(oppItemIdx, 1)[0];
  if (me.items.length < MAX_ITEM_SLOTS) {
    me.items.push(stolenKey);
  }
  AudioEngine.itemUse();
  const stolenInfo = ITEMS_DB[stolenKey];
  setActionBanner(`🦝 سرقت (${stolenInfo.icon} ${stolenInfo.name}) من ${targetOpp.name} بنجاح!`, 'gold', true);
  renderGameUI();
}

function executeSwapperOnOpponent(targetOppId) {
  const pending = AppState.pendingTargetedItem;
  toggleModal('opponentPickerModal', false);
  AppState.pendingTargetedItem = null;
  if (!pending || pending.type !== 'swapper') return;

  if (OnlineSession.isOnlineMatch && socket && OnlineSession.connected) {
    socket.emit('use_item', {
      slotIndex: pending.slotIndex,
      targetId: targetOppId
    });
    return;
  }

  const m = AppState.match;
  const me = getSelfPlayer();
  const targetOpp = m.players.find(p => p.id === targetOppId);
  if (!targetOpp || targetOpp.hp <= 0) return;
  if (me.items[pending.slotIndex] !== 'swapper') return;

  me.items.splice(pending.slotIndex, 1);
  m.itemsUsedCount++;

  if (checkAndConsumeShield(me, targetOpp, 'المبادل 🔄')) {
    renderGameUI();
    return;
  }

  const myOldItems = [...me.items];
  const oppOldItems = [...targetOpp.items];
  me.items = oppOldItems.slice(0, MAX_ITEM_SLOTS);
  targetOpp.items = myOldItems.slice(0, MAX_ITEM_SLOTS);
  AudioEngine.itemUse();
  setActionBanner(`🔄 قمت بتبديل جميع أدواتك مع ${targetOpp.name}!`, 'gold', true);
  renderGameUI();
}

function cancelOpponentPicker() {
  AppState.pendingTargetedItem = null;
  toggleModal('opponentPickerModal', false);
}

function usePlayerItem(slotIndex) {
  const m = AppState.match;
  const me = getSelfPlayer();
  const activeP = getCurrentTurnPlayer();
  if (!activeP || !activeP.isSelf || m.isBusy) return;

  const itemKey = me.items[slotIndex];
  if (!itemKey) return;

  if (itemKey === 'thief' || itemKey === 'swapper') {
    openOpponentPickerForItem(itemKey, slotIndex);
    return;
  }

  if (OnlineSession.isOnlineMatch && socket && OnlineSession.connected) {
    ensureValidSelectedTarget();
    socket.emit('use_item', {
      slotIndex,
      targetId: m.selectedTargetId
    });
    return;
  }

  if (itemKey === 'glass') {
    me.items.splice(slotIndex, 1);
    m.itemsUsedCount++;
    AudioEngine.itemUse();
    const nextShell = m.chamber[0];
    const box = document.getElementById('peekResultBox');
    if (nextShell === 'live') {
      box.className = 'my-4 py-4 px-3 rounded-2xl border border-red-500 bg-red-500/15 text-red-400 font-black text-lg flex flex-col items-center gap-2';
      box.innerHTML = `${createShellSVG('live', 'w-9 h-16')}<span>🔴 رصاصة حية (LIVE)</span>`;
    } else {
      box.className = 'my-4 py-4 px-3 rounded-2xl border border-sky-500 bg-sky-500/15 text-sky-400 font-black text-lg flex flex-col items-center gap-2';
      box.innerHTML = `${createShellSVG('blank', 'w-9 h-16')}<span>⚪ رصاصة فارغة (BLANK)</span>`;
    }
    toggleModal('peekModal', true);
    setActionBanner('🔍 استخدمت العدسة المكبرة لفحص بيت النار');
  }
  else if (itemKey === 'saw') {
    if (m.doubleDamage) {
      setActionBanner('⚠️ المنشار مفعّل بالفعل لهذه الطلقة!', 'gold');
      return;
    }
    me.items.splice(slotIndex, 1);
    m.itemsUsedCount++;
    AudioEngine.sawSound();
    m.doubleDamage = true;
    updateShotgunBarrelVisual(true);
    setActionBanner('🪚 تم قص الفوهة! الطلقة القادمة ستسبب ضرر x2', 'danger');
  }
  else if (itemKey === 'drink') {
    me.items.splice(slotIndex, 1);
    m.itemsUsedCount++;
    AudioEngine.rack();
    const ejected = m.chamber.shift();
    triggerShellEjectAnimation(ejected);
    const label = ejected === 'live' ? 'حية 🔴' : 'فارغة ⚪';
    setActionBanner(`🥤 شربت الطاقة وأخرجت رصاصة (${label})`, ejected === 'live' ? 'danger' : 'safe');

    if (m.chamber.length === 0) {
      renderGameUI();
      setTimeout(() => {
        m.round++;
        startNewRound();
      }, 1200);
      return;
    }
  }
  else if (itemKey === 'cuffs') {
    ensureValidSelectedTarget();
    const targetOpp = m.players.find(p => p.id === m.selectedTargetId);
    if (!targetOpp || targetOpp.cuffed) {
      setActionBanner('⚠️ الهدف المحدد مقيد بالفعل أو غير صالح!', 'gold');
      return;
    }
    me.items.splice(slotIndex, 1);
    m.itemsUsedCount++;
    if (checkAndConsumeShield(me, targetOpp, 'القيود الحديدية ⛓️')) {
      renderGameUI();
      return;
    }
    AudioEngine.itemUse();
    targetOpp.cuffed = true;
    setActionBanner(`⛓️ قمت بتقييد ${targetOpp.name}! سيتخطى دوره القادم`, 'gold');
  }
  else if (itemKey === 'smoke' || itemKey === 'paracetamol') {
    const playerMaxHp = me.maxHp || m.maxHp || 5;
    if (me.hp >= playerMaxHp) {
      setActionBanner('⚠️ صحتك ممتلئة بالفعل (5/5)!', 'gold');
      return;
    }
    me.items.splice(slotIndex, 1);
    m.itemsUsedCount++;
    AudioEngine.healSound();
    me.hp = Math.min(playerMaxHp, me.hp + 1);
    showFloatingHpChange('+1 ❤️', false, 'bottom');
    setActionBanner(`💊 تناولت البراسيتول واستعدت +1 قلب (${me.hp}/${playerMaxHp})!`, 'safe');
  }
  else if (itemKey === 'flipper') {
    if (m.chamber.length === 0) return;
    me.items.splice(slotIndex, 1);
    m.itemsUsedCount++;
    AudioEngine.rack();
    m.chamber[0] = (m.chamber[0] === 'live') ? 'blank' : 'live';
    setActionBanner('🔁 استخدمت القلّاب! تم عكس نوع الرصاصة الحالية في بيت النار سراً!', 'gold');
  }
  else if (itemKey === 'shield') {
    if (me.hasShield) {
      setActionBanner('⚠️ لديك درع حماية مفعّل بالفعل!', 'gold');
      return;
    }
    me.items.splice(slotIndex, 1);
    m.itemsUsedCount++;
    AudioEngine.shieldBlock();
    me.hasShield = true;
    setActionBanner('🛡️ فعّلت الدرع! سيحميك من السارق والمبادل والقيود حتى يصد أداة واحدة.', 'safe');
  }
  else if (itemKey === 'pillow') {
    me.items.splice(slotIndex, 1);
    m.itemsUsedCount++;
    AudioEngine.pillowSoft();
    me.pillowTurns = 2;
  }

  renderGameUI();
}

function triggerShellEjectAnimation(type) {
  const wrapper = document.getElementById('ejectedShellVisual');
  const body = document.getElementById('ejectedShellBody');
  body.className = 'w-6 h-11';
  body.innerHTML = createShellSVG(type, 'w-6 h-11');

  wrapper.classList.remove('hidden', 'shell-ejecting');
  void wrapper.offsetWidth;
  wrapper.classList.add('shell-ejecting');
  setTimeout(() => wrapper.classList.add('hidden'), 800);
}

/**
 * 11. MULTIPLAYER SHOOTING & TURN RESOLUTION
 */
function handlePlayerShoot(mode) {
  const m = AppState.match;
  const activeP = getCurrentTurnPlayer();
  if (!activeP || !activeP.isSelf || m.isBusy) return;

  if (OnlineSession.isOnlineMatch && socket && OnlineSession.connected) {
    if (mode === 'self') {
      socket.emit('player_shoot', { targetId: activeP.id });
    } else {
      ensureValidSelectedTarget();
      if (m.selectedTargetId === null || typeof m.selectedTargetId === 'undefined') return;
      socket.emit('player_shoot', { targetId: m.selectedTargetId });
    }
    return;
  }

  if (mode === 'self') {
    executeShot(activeP.id, activeP.id);
  } else {
    ensureValidSelectedTarget();
    if (!m.selectedTargetId) return;
    executeShot(activeP.id, m.selectedTargetId);
  }
}

function executeShot(shooterId, targetId) {
  const m = AppState.match;
  const shooter = m.players.find(p => p.id === shooterId);
  const target = m.players.find(p => p.id === targetId);
  if (!shooter || !target) return;

  m.isBusy = true;
  stopTurnTimer();
  renderGameUI();

  aimShotgunAtTarget(target, false);

  const isSelfShot = shooter.id === target.id;
  const targetNameText = isSelfShot ? 'نفسه' : target.name;
  const shooterWeapon = getWeaponMeta(shooter.weaponId).name;
  setActionBanner(`${shooter.name} (${shooterWeapon}) يصوّب نحو ${targetNameText}...`, 'neutral', true);

  setTimeout(() => {
    aimShotgunAtTarget(target, true);
    const shell = m.chamber.shift();
    const damage = m.doubleDamage ? 2 : 1;

    m.doubleDamage = false;
    updateShotgunBarrelVisual(false);

    if (shell === 'live') {
      AudioEngine.liveBlast();
      triggerShellEjectAnimation('live');
      const flash = document.getElementById('muzzleFlash');
      flash.classList.remove('flash-active');
      void flash.offsetWidth;
      flash.classList.add('flash-active');

      const frame = document.getElementById('appFrame');
      frame.classList.remove('shake-screen');
      void frame.offsetWidth;
      frame.classList.add('shake-screen');

      if (target.pillowTurns > 0) {
        target.pillowTurns = 0;
        AudioEngine.pillowSoft();
        showFloatingHpChange('🛏️ صُدّت!', false, target.isSelf ? 'bottom' : 'top');
        setActionBanner(`🛏️ مفاجأة! وسادة سرية لدى ${targetNameText} امتصّت الرصاصة الحية بالكامل!`, 'safe', true);
      } else {
        target.hp = Math.max(0, Number(target.hp) - damage);
        if (target.hp <= 0) {
          target.hp = 0;
          target.eliminated = true;
        }
        triggerBloodEffect(target, damage);
        showFloatingHpChange(`-${damage} ❤️`, true, target.isSelf ? 'bottom' : 'top');
        const elimText = target.hp === 0 ? ` (تم إقصاء ${target.name} 💀)` : '';
        setActionBanner(`💥 طلق حي! دماء تسيل من ${targetNameText} (-${damage} ❤️)${elimText}`, 'danger', true);
      }
    } else {
      AudioEngine.blankClick();
      triggerShellEjectAnimation('blank');
      setActionBanner(`💨 *تك!* رصاصة فارغة (Blank) على ${targetNameText}!`, 'safe', true);
    }

    ensureValidSelectedTarget();
    renderGameUI();

    setTimeout(() => {
      resetShotgunAim();

      const me = getSelfPlayer();
      const aliveOpps = getAliveOpponents();

      if (me.hp <= 0) {
        endMatch(false);
        return;
      }
      if (aliveOpps.length === 0) {
        endMatch(true);
        return;
      }

      const keepTurn = (isSelfShot && shell === 'blank' && shooter.hp > 0);
      if (keepTurn) {
        setActionBanner(`🔥 ${shooter.name} أطلق فارغة على نفسه واحتفظ بدوره!`, 'gold', true);
      }

      if (m.chamber.length === 0) {
        if (!keepTurn) {
          advanceTurnIndex();
        }
        setActionBanner('🔄 انتهت ذخيرة الجولة! جاري إعادة الحشو...', 'gold', true);
        setTimeout(() => {
          m.round++;
          startNewRound();
        }, 1300);
        return;
      }

      if (!keepTurn) {
        advanceTurnIndex();
      }

      m.isBusy = false;
      startTurnTimer();
      renderGameUI();

      const nextPlayer = getCurrentTurnPlayer();
      if (nextPlayer && !nextPlayer.isSelf) {
        setTimeout(runOpponentAI, 650);
      } else if (nextPlayer && nextPlayer.isSelf) {
        const targetObj = m.players.find(p => p.id === m.selectedTargetId);
        aimShotgunAtTarget(targetObj, false);
      }
    }, 1150);
  }, 650);
}

/**
 * 12. MULTIPLAYER BOT AI LOGIC (LOCAL BOT MODE)
 */
function runOpponentAI() {
  if (OnlineSession.isOnlineMatch) return;
  const m = AppState.match;
  const bot = getCurrentTurnPlayer();
  if (!m.active || !bot || bot.isSelf || bot.hp <= 0 || m.isBusy) return;

  const liveLeft = m.chamber.filter(s => s === 'live').length;
  const blankLeft = m.chamber.filter(s => s === 'blank').length;
  let knownNextShell = null;

  const shieldIdx = bot.items.indexOf('shield');
  if (shieldIdx !== -1 && !bot.hasShield) {
    bot.items.splice(shieldIdx, 1);
    bot.hasShield = true;
    AudioEngine.shieldBlock();
    setActionBanner(`🛡️ ${bot.name} فعّل الدرع لحماية نفسه من الأدوات!`, 'safe', true);
    renderGameUI();
    setTimeout(runOpponentAI, 520);
    return;
  }

  const pillowIdx = bot.items.indexOf('pillow');
  if (pillowIdx !== -1 && bot.pillowTurns <= 0 && liveLeft > 0) {
    bot.items.splice(pillowIdx, 1);
    bot.pillowTurns = 2;
    renderGameUI();
    setTimeout(runOpponentAI, 350);
    return;
  }

  const smokeIdx = bot.items.indexOf('smoke');
  const botMaxHp = bot.maxHp || m.maxHp || 5;
  if (smokeIdx !== -1 && bot.hp < botMaxHp) {
    bot.items.splice(smokeIdx, 1);
    AudioEngine.healSound();
    bot.hp = Math.min(botMaxHp, bot.hp + 1);
    showFloatingHpChange('+1 ❤️', false, 'top');
    setActionBanner(`💊 ${bot.name} تناول البراسيتول واستعاد +1 قلب (${bot.hp}/${botMaxHp})`, 'gold', true);
    renderGameUI();
    setTimeout(runOpponentAI, 520);
    return;
  }

  const thiefIdx = bot.items.indexOf('thief');
  const otherAlive = getAlivePlayers().filter(p => p.id !== bot.id);
  if (thiefIdx !== -1 && otherAlive.length > 0 && bot.items.length <= MAX_ITEM_SLOTS - 1) {
    bot.items.splice(thiefIdx, 1);
    const victim = otherAlive[Math.floor(Math.random() * otherAlive.length)];
    if (checkAndConsumeShield(bot, victim, 'السارق 🦝')) {
      renderGameUI();
      setTimeout(runOpponentAI, 520);
      return;
    }
    if (victim.items.length > 0) {
      const sIdx = Math.floor(Math.random() * victim.items.length);
      const stolenKey = victim.items.splice(sIdx, 1)[0];
      bot.items.push(stolenKey);
      AudioEngine.itemUse();
      const stolenLabel = victim.isSelf ? `منك (${ITEMS_DB[stolenKey].name})` : `من ${victim.name}`;
      setActionBanner(`🦝 ${bot.name} استخدم السارق وسرق أداة ${stolenLabel}!`, 'danger', true);
    } else {
      AudioEngine.blankClick();
      setActionBanner(`🦝 ${bot.name} حاول السرقة من ${victim.name} لكن مخزونه فارغ!`, 'gold', true);
    }
    renderGameUI();
    setTimeout(runOpponentAI, 520);
    return;
  }

  const swapperIdx = bot.items.indexOf('swapper');
  if (swapperIdx !== -1 && otherAlive.length > 0 && bot.items.length <= 2) {
    bot.items.splice(swapperIdx, 1);
    const victim = otherAlive[Math.floor(Math.random() * otherAlive.length)];
    if (checkAndConsumeShield(bot, victim, 'المبادل 🔄')) {
      renderGameUI();
      setTimeout(runOpponentAI, 520);
      return;
    }
    const botOld = [...bot.items];
    const vicOld = [...victim.items];
    bot.items = vicOld.slice(0, MAX_ITEM_SLOTS);
    victim.items = botOld.slice(0, MAX_ITEM_SLOTS);
    AudioEngine.itemUse();
    setActionBanner(`🔄 ${bot.name} استخدم المبادل وبدّل جميع أدواته مع ${victim.isSelf ? 'أدواتك' : victim.name}!`, 'danger', true);
    renderGameUI();
    setTimeout(runOpponentAI, 520);
    return;
  }

  const glassIdx = bot.items.indexOf('glass');
  if (glassIdx !== -1 && liveLeft > 0 && blankLeft > 0) {
    bot.items.splice(glassIdx, 1);
    AudioEngine.itemUse();
    knownNextShell = m.chamber[0];
    setActionBanner(`🔍 ${bot.name} استخدم العدسة المكبرة لفحص الطلقة...`, 'gold', true);
    renderGameUI();
    setTimeout(() => decideAIShot(bot, knownNextShell, liveLeft, blankLeft), 520);
    return;
  }

  const flipperIdx = bot.items.indexOf('flipper');
  if (flipperIdx !== -1 && m.chamber.length > 0 && Math.random() < 0.45) {
    bot.items.splice(flipperIdx, 1);
    AudioEngine.rack();
    m.chamber[0] = (m.chamber[0] === 'live') ? 'blank' : 'live';
    if (knownNextShell) {
      knownNextShell = m.chamber[0];
    }
    setActionBanner(`🔁 ${bot.name} استخدم القلّاب وعكس الرصاصة في بيت النار!`, 'gold', true);
    renderGameUI();
    setTimeout(() => decideAIShot(bot, knownNextShell, liveLeft, blankLeft), 520);
    return;
  }

  const cuffsIdx = bot.items.indexOf('cuffs');
  const cuffCandidates = getAlivePlayers().filter(p => p.id !== bot.id && !p.cuffed);
  if (cuffsIdx !== -1 && cuffCandidates.length > 0 && m.chamber.length > 1) {
    bot.items.splice(cuffsIdx, 1);
    const victim = cuffCandidates[Math.floor(Math.random() * cuffCandidates.length)];
    if (checkAndConsumeShield(bot, victim, 'القيود الحديدية ⛓️')) {
      renderGameUI();
      setTimeout(runOpponentAI, 520);
      return;
    }
    AudioEngine.itemUse();
    victim.cuffed = true;
    setActionBanner(`⛓️ ${bot.name} قيّد ${victim.name}! سيتخطى دوره القادم`, 'danger', true);
    renderGameUI();
    setTimeout(runOpponentAI, 520);
    return;
  }

  decideAIShot(bot, knownNextShell, liveLeft, blankLeft);
}

function decideAIShot(bot, knownNextShell, liveLeft, blankLeft) {
  const m = AppState.match;
  if (!m.active || getCurrentTurnPlayer().id !== bot.id) return;

  const shootOther = knownNextShell
    ? knownNextShell === 'live'
    : liveLeft >= blankLeft;

  if (!shootOther) {
    executeShot(bot.id, bot.id);
    return;
  }

  const targets = getAlivePlayers().filter(p => p.id !== bot.id);
  if (targets.length === 0) return;
  const chosenTarget = targets[Math.floor(Math.random() * targets.length)];

  aimShotgunAtTarget(chosenTarget, false);

  const sawIdx = bot.items.indexOf('saw');
  if (sawIdx !== -1 && !m.doubleDamage && (knownNextShell === 'live' || liveLeft > blankLeft)) {
    bot.items.splice(sawIdx, 1);
    AudioEngine.sawSound();
    m.doubleDamage = true;
    updateShotgunBarrelVisual(true);
    setActionBanner(`🪚 ${bot.name} قصّ فوهة السلاح بالمنشار نحو ${chosenTarget.name}!`, 'danger', true);
    renderGameUI();
    setTimeout(() => {
      executeShot(bot.id, chosenTarget.id);
    }, 520);
    return;
  }

  setActionBanner(`🎯 ${bot.name} يوجّه سلاحه نحو ${chosenTarget.name}...`, 'neutral', true);
  setTimeout(() => {
    executeShot(bot.id, chosenTarget.id);
  }, 450);
}

/**
 * 13. ENDGAME, STATS PERSISTENCE & DOUBLE OR NOTHING
 */
function endMatch(playerWon) {
  const m = AppState.match;
  m.active = false;
  m.isBusy = false;
  stopTurnTimer();
  resetShotgunAim();

  AppState.matches += 1;
  const doubleBtn = document.getElementById('doubleOrNothingBtn');

  document.getElementById('statRounds').textContent = m.round;
  document.getElementById('statItems').textContent = m.itemsUsedCount;

  if (playerWon) {
    AudioEngine.win();
    AppState.wins += 1;
    AppState.streak += 1;

    const baseReward = AppState.isDoubleOrNothingRun
      ? AppState.lastVictoryReward * 2
      : (2 + Math.min(3, Math.floor(AppState.streak / 2)));

    AppState.lastVictoryReward = baseReward;
    AppState.tickets += baseReward;

    document.getElementById('endIcon').textContent = '🏆';
    document.getElementById('endTitle').textContent = AppState.isDoubleOrNothingRun ? 'مضاعفة أسطورية!' : 'انتصار ساحق!';
    document.getElementById('endTitle').className = 'text-2xl font-black text-emerald-400';
    document.getElementById('endSubtitle').textContent = `سلسلة انتصاراتك الحالية: ${AppState.streak} 🔥`;
    document.getElementById('statReward').textContent = `+${baseReward} تذاكر 🎟️`;
    if (doubleBtn) doubleBtn.classList.remove('hidden');
  } else {
    AudioEngine.lose();
    AppState.streak = 0;
    if (AppState.isDoubleOrNothingRun) {
      AppState.tickets = Math.max(0, AppState.tickets - AppState.lastVictoryReward);
    }
    AppState.isDoubleOrNothingRun = false;

    document.getElementById('endIcon').textContent = '💀';
    document.getElementById('endTitle').textContent = 'تم إقصاؤك!';
    document.getElementById('endTitle').className = 'text-2xl font-black text-red-500';
    document.getElementById('endSubtitle').textContent = 'حظاً أوفر في التحدي القادم';
    document.getElementById('statReward').textContent = '0 تذاكر';
    if (doubleBtn) doubleBtn.classList.add('hidden');
  }

  saveProfile();
  updateTicketsAndStatsUI();
  toggleModal('gameOverModal', true);
}

function triggerDoubleOrNothing() {
  toggleModal('gameOverModal', false);
  OnlineSession.isOnlineMatch = false;
  AppState.isDoubleOrNothingRun = true;
  AppState.currentMode = 'bot';
  const participants = [
    {
      id: 'player',
      name: 'أنت',
      avatar: '😎',
      isBot: false,
      isSelf: true,
      weaponId: AppState.equippedWeapon,
      skinId: AppState.equippedSkin
    },
    {
      id: 'bot_champion',
      name: 'Bot_Champion',
      avatar: '👑',
      isBot: true,
      isSelf: false,
      weaponId: 'bazooka',
      skinId: 'sumerian'
    }
  ];
  initMatch(participants);
}

function restartSameMode() {
  toggleModal('gameOverModal', false);
  AppState.isDoubleOrNothingRun = false;
  if (AppState.currentMode === 'bot') {
    confirmStartBotMatch();
  } else if (AppState.currentMode === 'quick') {
    startQuickMatch();
  } else {
    backToMenuFromEnd();
  }
}

function backToMenuFromEnd() {
  AppState.isDoubleOrNothingRun = false;
  OnlineSession.isOnlineMatch = false;
  OnlineSession.roomId = null;
  OnlineSession.myPlayerId = null;
  OnlineSession.serverPlayers = [];
  OnlineSession.lobbyBots = [];
  toggleModal('gameOverModal', false);
  updateTicketsAndStatsUI();
  showScreen('screen-menu');
}

function confirmLeaveGame() {
  if (OnlineSession.isOnlineMatch && socket && OnlineSession.connected && OnlineSession.roomId) {
    socket.emit('leave_room', { roomId: OnlineSession.roomId, code: OnlineSession.roomId });
  }
  AppState.match.active = false;
  AppState.isDoubleOrNothingRun = false;
  OnlineSession.isOnlineMatch = false;
  OnlineSession.roomId = null;
  OnlineSession.myPlayerId = null;
  OnlineSession.serverPlayers = [];
  OnlineSession.lobbyBots = [];
  stopTurnTimer();
  updateTicketsAndStatsUI();
  showScreen('screen-menu');
}

// Initialize safely on load
(function bootstrapApp() {
  loadProfile();
  updateTicketsAndStatsUI();
  updateTableActiveWeaponVisual();
  initServerConnection();
})();
