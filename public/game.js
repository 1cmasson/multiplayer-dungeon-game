const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const playerCountEl = document.getElementById('playerCount');
const roomIdEl = document.getElementById('roomId');
const mapDepthEl = document.getElementById('mapDepth');
const totalKillsEl = document.getElementById('totalKills');
const playerLivesEl = document.getElementById('playerLives');

// Network monitoring
let bytesReceived = 0;
let messagesReceived = 0;
let initialStateSizeBytes = 0;

// ==========================================
// TOUCH CONTROLS SYSTEM (Floating Joystick + Tap to Shoot)
// ==========================================
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
let touchControlsEnabled = isTouchDevice;

// Joystick state tracking
const joystickState = {
  active: false,
  touchId: null,          // Track which touch is controlling the joystick
  baseX: 0,               // Center position of joystick base
  baseY: 0,
  knobX: 0,               // Current knob position (relative to base center)
  knobY: 0,
  angle: 0,               // Current angle in radians
  distance: 0,            // Distance from center (0-1 normalized)
  currentDirection: null, // Current discrete direction being sent
  
  // Shooting
  lastShootTime: 0,
  shootCooldown: 150,     // ms between shots
};

// Joystick configuration
const JOYSTICK_CONFIG = {
  baseRadius: 60,         // Radius of the outer circle
  knobRadius: 25,         // Radius of the inner knob
  deadzone: 0.15,         // Minimum distance to register input (0-1)
  moveThrottle: 100,      // ms between movement commands
};

// Direction to angle mapping (4 cardinal directions)
const DIRECTION_ANGLES = {
  'right': 0,
  'down': Math.PI / 2,
  'left': Math.PI,
  'up': -Math.PI / 2,
};

// Initialize touch controls
function initTouchControls() {
  if (!touchControlsEnabled) return;
  
  const touchControls = document.getElementById('touchControls');
  const joystickZone = document.getElementById('joystickZone');
  const joystickBase = document.getElementById('joystickBase');
  const joystickKnob = document.getElementById('joystickKnob');
  const shootZone = document.getElementById('shootZone');
  
  if (!touchControls || !joystickZone) {
    console.warn('Touch control elements not found');
    return;
  }
  
  touchControls.classList.add('active');
  
  // Joystick zone handlers
  joystickZone.addEventListener('touchstart', handleJoystickStart, { passive: false });
  joystickZone.addEventListener('touchmove', handleJoystickMove, { passive: false });
  joystickZone.addEventListener('touchend', handleJoystickEnd, { passive: false });
  joystickZone.addEventListener('touchcancel', handleJoystickEnd, { passive: false });
  
  // Shoot zone handler
  if (shootZone) {
    shootZone.addEventListener('touchstart', handleShootStart, { passive: false });
    shootZone.addEventListener('touchend', handleShootEnd, { passive: false });
    shootZone.addEventListener('touchcancel', handleShootEnd, { passive: false });
  }
  
  // Prevent default touch behaviors on canvas
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  
  // Prevent context menu on long press
  joystickZone.addEventListener('contextmenu', (e) => e.preventDefault());
  
  // Show touch hint briefly
  showTouchHint();
  
  console.log('Floating joystick touch controls initialized');
}

// Show touch hint for new users
function showTouchHint() {
  const hasSeenHint = localStorage.getItem('touchHintSeen');
  if (hasSeenHint) return;
  
  const hint = document.getElementById('touchHint');
  if (!hint) return;
  
  // Show after a short delay
  setTimeout(() => {
    hint.classList.add('visible');
    
    // Hide after 3 seconds
    setTimeout(() => {
      hint.classList.remove('visible');
      localStorage.setItem('touchHintSeen', 'true');
    }, 3000);
  }, 1000);
}

// Joystick touch handlers
function handleJoystickStart(e) {
  e.preventDefault();
  
  // Only handle if no joystick is active
  if (joystickState.active) return;
  
  const touch = e.changedTouches[0];
  
  // Store which touch ID is controlling the joystick
  joystickState.active = true;
  joystickState.touchId = touch.identifier;
  
  // Position the joystick base at the touch point
  joystickState.baseX = touch.clientX;
  joystickState.baseY = touch.clientY;
  joystickState.knobX = 0;
  joystickState.knobY = 0;
  joystickState.distance = 0;
  joystickState.currentDirection = null;
  
  // Show and position the joystick base
  const joystickBase = document.getElementById('joystickBase');
  if (joystickBase) {
    joystickBase.style.left = joystickState.baseX + 'px';
    joystickBase.style.top = joystickState.baseY + 'px';
    joystickBase.classList.add('active');
  }
  
  // Reset knob to center
  const joystickKnob = document.getElementById('joystickKnob');
  if (joystickKnob) {
    joystickKnob.style.transform = 'translate(-50%, -50%)';
    joystickKnob.classList.remove('moving');
  }
}

function handleJoystickMove(e) {
  e.preventDefault();
  
  if (!joystickState.active) return;
  
  // Find the touch that's controlling our joystick
  let touch = null;
  for (let i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === joystickState.touchId) {
      touch = e.changedTouches[i];
      break;
    }
  }
  
  if (!touch) return;
  
  // Calculate offset from base center
  const deltaX = touch.clientX - joystickState.baseX;
  const deltaY = touch.clientY - joystickState.baseY;
  
  // Calculate distance and angle
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  const maxDistance = JOYSTICK_CONFIG.baseRadius;
  
  // Clamp distance to base radius
  const clampedDistance = Math.min(distance, maxDistance);
  const normalizedDistance = clampedDistance / maxDistance;
  
  // Calculate clamped position
  let knobX, knobY;
  if (distance > 0) {
    knobX = (deltaX / distance) * clampedDistance;
    knobY = (deltaY / distance) * clampedDistance;
  } else {
    knobX = 0;
    knobY = 0;
  }
  
  // Update state
  joystickState.knobX = knobX;
  joystickState.knobY = knobY;
  joystickState.distance = normalizedDistance;
  joystickState.angle = Math.atan2(deltaY, deltaX);
  
  // Update knob visual position
  const joystickKnob = document.getElementById('joystickKnob');
  if (joystickKnob) {
    joystickKnob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;
    
    // Add moving class when outside deadzone
    if (normalizedDistance > JOYSTICK_CONFIG.deadzone) {
      joystickKnob.classList.add('moving');
    } else {
      joystickKnob.classList.remove('moving');
    }
  }
  
  // Convert to discrete direction if outside deadzone
  if (normalizedDistance > JOYSTICK_CONFIG.deadzone) {
    const direction = getDirectionFromAngle(joystickState.angle);
    
    // Update player facing angle
    if (room && direction) {
      const facingAngle = DIRECTION_ANGLES[direction];
      if (facingAngle !== undefined) {
        room.send('updateAngle', { angle: facingAngle });
      }
    }
  }
}

function handleJoystickEnd(e) {
  e.preventDefault();
  
  // Check if this is the touch that was controlling the joystick
  let isOurTouch = false;
  for (let i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === joystickState.touchId) {
      isOurTouch = true;
      break;
    }
  }
  
  if (!isOurTouch) return;
  
  // Reset joystick state
  joystickState.active = false;
  joystickState.touchId = null;
  joystickState.knobX = 0;
  joystickState.knobY = 0;
  joystickState.distance = 0;
  joystickState.currentDirection = null;
  
  // Hide joystick base
  const joystickBase = document.getElementById('joystickBase');
  if (joystickBase) {
    joystickBase.classList.remove('active');
  }
  
  // Reset knob position
  const joystickKnob = document.getElementById('joystickKnob');
  if (joystickKnob) {
    joystickKnob.style.transform = 'translate(-50%, -50%)';
    joystickKnob.classList.remove('moving');
  }
}

// Convert joystick angle to 4-way cardinal direction
function getDirectionFromAngle(angle) {
  // Normalize angle to 0-2PI range
  let normalizedAngle = angle;
  if (normalizedAngle < 0) {
    normalizedAngle += 2 * Math.PI;
  }
  
  // Divide into 4 sectors (each 90 degrees / PI/2 radians)
  // Offset by 45 degrees so that "right" is centered at 0
  const sectorAngle = Math.PI / 2;
  const offset = sectorAngle / 2;
  
  const sector = Math.floor((normalizedAngle + offset) / sectorAngle) % 4;
  
  const directions = [
    'right',  // 0: -45 to 45 degrees
    'down',   // 1: 45 to 135 degrees
    'left',   // 2: 135 to 225 degrees
    'up',     // 3: 225 to 315 degrees (or -135 to -45)
  ];
  
  return directions[sector];
}

// Send movement command to server (4 cardinal directions)
function sendMoveCommand(direction) {
  if (!room || !mySessionId) return;
  
  const myPlayer = room.state.players.get(mySessionId);
  if (!myPlayer || myPlayer.lives <= 0) return;
  
  // Send the direction directly
  room.send('move', { direction });
}

// Shoot touch handlers
function handleShootStart(e) {
  e.preventDefault();
  
  const touch = e.changedTouches[0];
  
  // Shoot in the player's current facing direction
  shootInFacingDirection();
  
  // Show shoot indicator
  showShootIndicator(touch.clientX, touch.clientY);
}

// Shoot in player's current facing direction (for mobile)
function shootInFacingDirection() {
  if (!room || !mySessionId) return;
  
  const myPlayer = room.state.players.get(mySessionId);
  if (!myPlayer || myPlayer.lives <= 0) return;
  
  // Throttle shooting
  const now = Date.now();
  if (now - joystickState.lastShootTime < joystickState.shootCooldown) return;
  joystickState.lastShootTime = now;
  
  // Shoot using the player's current angle (facing direction)
  room.send('shoot', { angle: myPlayer.angle });
}

function handleShootEnd(e) {
  e.preventDefault();
}

function showShootIndicator(x, y) {
  const indicator = document.getElementById('shootIndicator');
  if (!indicator) return;
  
  indicator.style.left = x + 'px';
  indicator.style.top = y + 'px';
  indicator.classList.add('active');
  
  // Remove animation class after it completes
  setTimeout(() => {
    indicator.classList.remove('active');
  }, 150);
}

// Process joystick movement input (called in game loop)
function processJoystickMovement() {
  if (!touchControlsEnabled) return;
  if (!joystickState.active) return;
  if (joystickState.distance <= JOYSTICK_CONFIG.deadzone) return;
  if (!room || !mySessionId) return;
  
  const myPlayer = room.state.players.get(mySessionId);
  if (!myPlayer || myPlayer.lives <= 0) return;
  
  // Get direction from current joystick angle
  const direction = getDirectionFromAngle(joystickState.angle);
  
  // Send move command
  sendMoveCommand(direction);
}

// Touch movement processing interval
let touchMoveInterval = null;

function startTouchMoveLoop() {
  if (touchMoveInterval) return;
  
  // Process joystick movement every 100ms (same rate as keyboard repeat)
  touchMoveInterval = setInterval(() => {
    processJoystickMovement();
  }, JOYSTICK_CONFIG.moveThrottle);
}

function stopTouchMoveLoop() {
  if (touchMoveInterval) {
    clearInterval(touchMoveInterval);
    touchMoveInterval = null;
  }
}

// Seeded Random, TileType, and DungeonGenerator are now in dungeonGenerator.js
// This file uses those globals which are loaded before game.js

// Game state
let room = null;
let mySessionId = null;
let roomHostId = null; // Track who created the room
let dungeonGrid = [];
let dungeonWidth = 120;
let dungeonHeight = 120;
let activeTransports = []; // Track active transport locations from server
let teleportAnimations = []; // Track tiles that should fade out (destination indicators)
let muzzleFlashes = []; // Track muzzle flash effects
let damageEffects = []; // Track damage numbers and effects
let botPaths = {}; // Track bot paths for debugging visualization

// Waiting room state
let isHost = false;
let gameStarted = false;

// Debug configuration
let debugConfig = {
  showBotPaths: false,      // OFF by default
  showBotStats: false,
  panelOpen: false
};

// Bot interpolation system for smooth movement
const botInterpolation = new Map(); // botId → { prevX, prevY, prevTargetX, prevTargetY, startTime }
const BOT_MOVE_DURATION = 333; // Must match server MOVE_INTERVAL

// Camera/viewport
let cameraX = 0;
let cameraY = 0;

// Interpolation helpers
function lerp(start, end, t) {
  return start + (end - start) * Math.min(1, t);
}

function getInterpolatedBotPosition(bot) {
  const interpData = botInterpolation.get(bot.id);
  if (!interpData) {
    // No interpolation data yet, return logical position
    return { x: bot.x, y: bot.y };
  }
  
  // Check if bot has new target (moved to new tile)
  if (bot.targetX !== interpData.prevTargetX || bot.targetY !== interpData.prevTargetY) {
    // Bot started moving to new target
    interpData.prevX = interpData.prevTargetX;
    interpData.prevY = interpData.prevTargetY;
    interpData.prevTargetX = bot.targetX;
    interpData.prevTargetY = bot.targetY;
    interpData.startTime = bot.moveStartTime || Date.now();
  }
  
  // Calculate progress (0.0 → 1.0)
  const elapsed = Date.now() - interpData.startTime;
  const progress = Math.min(1, elapsed / BOT_MOVE_DURATION);
  
  // Safety check: if progress way too high, assume desync and snap to target
  if (progress > 1.5) {
    interpData.prevX = bot.targetX;
    interpData.prevY = bot.targetY;
    interpData.prevTargetX = bot.targetX;
    interpData.prevTargetY = bot.targetY;
    interpData.startTime = Date.now();
    return { x: bot.targetX, y: bot.targetY };
  }
  
  // Interpolate from previous position to target
  const displayX = lerp(interpData.prevX, bot.targetX, progress);
  const displayY = lerp(interpData.prevY, bot.targetY, progress);
  
  return { x: displayX, y: displayY };
}
const TILE_SIZE = 16;
let VIEWPORT_TILES_X = 50;
let VIEWPORT_TILES_Y = 50;

// Resize canvas to fill available space (mobile-first)
function resizeCanvas() {
  // Get container or window dimensions
  const container = document.getElementById('gameContainer');
  
  let availableWidth, availableHeight;
  
  if (isTouchDevice) {
    // Mobile: Fill the entire screen
    availableWidth = window.innerWidth;
    availableHeight = window.innerHeight;
  } else {
    // Desktop: Use container or reasonable max size
    availableWidth = Math.min(window.innerWidth * 0.95, 1200);
    availableHeight = Math.min(window.innerHeight * 0.85, 900);
  }
  
  // Set canvas to fill available space
  canvas.width = availableWidth;
  canvas.height = availableHeight;

  // Update viewport calculations
  VIEWPORT_TILES_X = Math.floor(canvas.width / TILE_SIZE);
  VIEWPORT_TILES_Y = Math.floor(canvas.height / TILE_SIZE);

  // Re-render after resize
  render();
  
  console.log(`Canvas resized: ${canvas.width}x${canvas.height}, viewport: ${VIEWPORT_TILES_X}x${VIEWPORT_TILES_Y} tiles`);
}

// Initialize canvas size
resizeCanvas();

// Handle window resize with debouncing
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(resizeCanvas, 100);
});

// Handle orientation change
window.addEventListener('orientationchange', () => {
  setTimeout(resizeCanvas, 200);
});

// Tile colors (improved contrast)
const COLORS = {
  WALL: '#1a1a1a',      // Darker for better contrast
  FLOOR: '#4a5a4a',     // Lighter gray-green
  EXIT: '#8bac0f',      // Light green
  SPAWN: '#9bbc0f',     // Lighter green
  OBSTACLE: '#000000',  // Pure black for clear distinction
  TRANSPORT_INACTIVE: '#4d94ff', // Blue (used portal)
  TRANSPORT_ACTIVE: '#ff00ff',   // Magenta (for debugging - normally invisible)
  ENTRY_PORTAL: '#9b59b6',       // Purple portal (go back)
  EXIT_PORTAL: '#27ae60',        // Green portal (go forward)
  HOME_MARKER: '#f39c12',        // Gold/orange (starting map marker)
  PLAYER: '#0f380f',    // Dark (current player)
  OTHER_PLAYER: '#8bac0f', // Light (other players)
};

// Dynamically determine server URL based on environment
function getServerConfig() {
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  
  if (isLocalhost) {
    // Local development
    return {
      wsUrl: 'ws://localhost:2567',
      httpUrl: 'http://localhost:2567'
    };
  } else {
    // Production (Railway or other hosted environment)
    // Use secure WebSocket (wss) and HTTPS
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const httpProtocol = window.location.protocol;
    const host = window.location.host; // includes port if non-standard
    
    return {
      wsUrl: `${protocol}//${host}`,
      httpUrl: `${httpProtocol}//${host}`
    };
  }
}

const serverConfig = getServerConfig();
console.log('🌐 Server config:', serverConfig);

// Connect to server
async function connect(roomName, create = false, playerName = '') {
  const client = new Colyseus.Client(serverConfig.wsUrl);

  try {
    if (create) {
      // Create new room
      room = await client.create('dungeon', { roomName, difficulty: 1, playerName });
    } else if (roomName) {
      // Join specific room by ID
      room = await client.joinById(roomName, { playerName });
    } else {
      // Join or create any available room
      room = await client.joinOrCreate('dungeon', { difficulty: 1, playerName });
    }
    mySessionId = room.sessionId;

    // Host status will be set based on server state
    // Don't assume host based on create - let server be authoritative
    
    statusEl.textContent = 'Connected! Waiting for game to start...';
    roomIdEl.textContent = room.roomId || 'Unknown';

    // Wait for state to be initialized before setting UI
    // These will be updated properly in the state change handler
    console.log('Joined room:', room.roomId);
    
    // Update panel display with room info
    updatePanelDisplay();
    
    // Subscribe to activity feed messages
    room.onMessage('activity', (message) => {
      addActivityMessage(message);
    });

    // Listen for game started event
    room.onMessage('gameStarted', (message) => {
      onGameStarted(message);
    });

    // Listen for host changed event
    room.onMessage('hostChanged', (message) => {
      onHostChanged(message);
    });

    // Monitor network traffic
    room.onMessage('*', (type, message) => {
      messagesReceived++;
      const messageSize = JSON.stringify(message).length;
      bytesReceived += messageSize;
    });

    // Listen for state changes
    room.state.onChange = () => {
      // Update player count
      playerCountEl.textContent = room.state.players ? room.state.players.size : 0;
      
      // Update panel player count
      updatePanelDisplay();

      // Update host and game started status
      if (room.state.hostSessionId) {
        roomHostId = room.state.hostSessionId;
        isHost = (room.state.hostSessionId === mySessionId);
      }
      
      // Check if game started status changed
      if (room.state.gameStarted && !gameStarted) {
        gameStarted = true;
        hideWaitingRoom();
        statusEl.textContent = 'Game started! Kill the bots!';
      }

      // Update waiting room UI if game hasn't started
      if (!gameStarted) {
        updateWaitingRoomUI();
      }

      // Update map depth display
      if (room.state.currentMapDepth !== undefined) {
        mapDepthEl.textContent = room.state.currentMapDepth;
      }

      // Update total kills display
      if (room.state.totalKills !== undefined) {
        totalKillsEl.textContent = room.state.totalKills;
      }

      // Update player lives
      const myPlayer = room.state.players.get(mySessionId);
      if (myPlayer && myPlayer.lives !== undefined) {
        playerLivesEl.textContent = myPlayer.lives;
      }

      // Update player list in panel
      updatePlayersList();

      messagesReceived++;
    };

    // Initial state setup - generate dungeon from seed
    room.onStateChange.once((state) => {
      console.log('📥 Received initial state:', state);

      dungeonWidth = state.width;
      dungeonHeight = state.height;
      
      // Set host status from server state
      roomHostId = state.hostSessionId;
      isHost = (state.hostSessionId === mySessionId);
      gameStarted = state.gameStarted;
      
      console.log('👑 Host:', roomHostId, 'Is me:', isHost, 'Game started:', gameStarted);
      
      // Show waiting room if game hasn't started yet
      if (!gameStarted) {
        showWaitingRoom();
        statusEl.textContent = isHost ? 'You are the host! Click START GAME when ready.' : 'Waiting for host to start...';
      } else {
        hideWaitingRoom();
        statusEl.textContent = 'Game in progress! Kill the bots!';
      }
      
      updatePanelDisplay();

      // Set up bullet tracking for debugging
      if (state.bullets) {
        state.bullets.onAdd = (bullet, key) => {
          console.log('🔫 Bullet added:', key, 'pos:', bullet.x.toFixed(2), bullet.y.toFixed(2), 'vel:', bullet.velocityX.toFixed(2), bullet.velocityY.toFixed(2));
        };

        state.bullets.onRemove = (bullet, key) => {
          console.log('💥 Bullet removed:', key, 'at pos:', bullet.x.toFixed(2), bullet.y.toFixed(2));
        };

        console.log('🔫 Bullets in state:', state.bullets.size);
      }

      // Set up bot interpolation tracking
      if (state.bots) {
        state.bots.onAdd = (bot, botId) => {
          // Initialize interpolation data when bot spawns
          botInterpolation.set(botId, {
            prevX: bot.x,
            prevY: bot.y,
            prevTargetX: bot.targetX,
            prevTargetY: bot.targetY,
            startTime: bot.moveStartTime || Date.now()
          });
          console.log('🤖 Bot added:', botId, 'at tile:', bot.x, bot.y);
        };

        state.bots.onRemove = (bot, botId) => {
          // Clean up interpolation data when bot dies
          botInterpolation.delete(botId);
          console.log('💀 Bot removed:', botId);
        };

        console.log('🤖 Bots in state:', state.bots.size);
        
        // Bots start at 0 before game starts - this is expected
        if (state.bots.size === 0 && state.gameStarted) {
          console.warn('⚠️ WARNING: No bots but game started! Check server logs.');
        }
      }

      // Set up player tracking for player list updates
      if (state.players) {
        state.players.onAdd = (player, sessionId) => {
          console.log('👤 Player added:', player.name, sessionId);
          updatePlayersList();
          updateWaitingRoomUI(); // Updates player list AND player count in waiting room
        };

        state.players.onRemove = (player, sessionId) => {
          console.log('👋 Player removed:', player.name, sessionId);
          updatePlayersList();
          updateWaitingRoomUI(); // Updates player list AND player count in waiting room
        };

        // Listen for player changes (lives, score, etc.)
        state.players.onChange = (player, sessionId) => {
          updatePlayersList();
        };

        console.log('👥 Players in state:', state.players.size);
      }

      // Set up transport tracking if available
      if (state.activeTransports) {
        // Initialize active transports array
        state.activeTransports.forEach(transport => {
          activeTransports.push({ x: transport.x, y: transport.y });
        });

        // Listen for transport changes
        state.activeTransports.onAdd = (transport, index) => {
          activeTransports.push({ x: transport.x, y: transport.y });
          console.log('🌀 Transport added at:', transport.x, transport.y);
        };

        state.activeTransports.onRemove = (transport, index) => {
          activeTransports = activeTransports.filter(t => !(t.x === transport.x && t.y === transport.y));
          console.log('🌀 Transport removed from:', transport.x, transport.y);
        };

        console.log('🌀 Active transports:', activeTransports.length);
      }

      // Measure initial state size
      const stateJSON = JSON.stringify({
        seed: state.seed,
        width: state.width,
        height: state.height,
        exitX: state.exitX,
        exitY: state.exitY
      });
      initialStateSizeBytes = new TextEncoder().encode(stateJSON).length;

      // Generate dungeon from seed (must produce same result as server!)
      // Get the current player to check their map depth and seed
      const myPlayer = state.players.get(mySessionId);
      
      // Use player's currentMapDepth and currentMapSeed if available (for late-joining players)
      // Otherwise fall back to state defaults (for players joining before game starts)
      const initialMapDepth = myPlayer?.currentMapDepth ?? state.currentMapDepth ?? 0;
      const initialMapSeed = myPlayer?.currentMapSeed ?? state.seed;
      
      console.log('🎲 Generating dungeon from seed:', initialMapSeed, 'at depth:', initialMapDepth);
      const generator = new DungeonGenerator(state.width, state.height, initialMapSeed);

      try {
        const dungeonData = generator.generate(initialMapDepth);
        dungeonGrid = dungeonData.grid;

        console.log('✅ Dungeon loaded:', dungeonWidth, 'x', dungeonHeight);
        console.log('🏠 Rooms:', dungeonData.rooms.length);
        console.log('🎯 Grid dimensions:', dungeonGrid.length, 'x', (dungeonGrid[0] ? dungeonGrid[0].length : 0));
        console.log(`📊 Initial state size: ${initialStateSizeBytes} bytes (${(initialStateSizeBytes / 1024).toFixed(2)} KB)`);

        // Log memory usage if available
        if (performance.memory) {
          console.log(`💾 Client memory: ${(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB / ${(performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(2)} MB`);
        }

        // Initialize UI with current state
        mapDepthEl.textContent = initialMapDepth;
        totalKillsEl.textContent = state.totalKills || 0;
        playerCountEl.textContent = state.players ? state.players.size : 0;

        if (myPlayer) {
          playerLivesEl.textContent = myPlayer.lives || 3;
        }

        render();
      } catch (error) {
        console.error('❌ Error generating dungeon:', error);
      }
    });

    // Listen for transport being used
    room.onMessage('transportUsed', (message) => {
      // Update the grid to show the transport as inactive (blue)
      if (dungeonGrid[message.y] && dungeonGrid[message.y][message.x] !== undefined) {
        dungeonGrid[message.y][message.x] = TileType.TRANSPORT_INACTIVE;
      }
    });

    // Listen for when THIS player gets teleported
    room.onMessage('teleported', (message) => {
      console.log('🌀 You were teleported!', message);
      console.log(`   From: (${message.fromX}, ${message.fromY}) → To: (${message.toX}, ${message.toY})`);
      
      // Verify player position matches server
      const myPlayer = room.state.players.get(mySessionId);
      if (myPlayer) {
        console.log(`   Player state after teleport: (${myPlayer.x}, ${myPlayer.y})`);
      }

      // Add destination tile to animation array
      // It will fade out over 2 seconds
      teleportAnimations.push({
        x: message.toX,
        y: message.toY,
        startTime: Date.now(),
        duration: 2000 // 2 seconds fade
      });
    });

    // Listen for legacy level advancement (deprecated - kept for backwards compatibility)
    room.onMessage('levelAdvanced', (message) => {
      console.log('⚠️ Received deprecated levelAdvanced message:', message);
      // This message type is deprecated - multi-map system uses mapChanged instead
    });

    // Listen for map change (portal navigation between depths)
    room.onMessage('mapChanged', (message) => {
      console.log('🗺️ Map changed!', message);

      // Regenerate dungeon grid with new seed
      const generator = new DungeonGenerator(room.state.width, room.state.height, message.newSeed);
      const newDungeonData = generator.generate(message.newDepth);
      dungeonGrid = newDungeonData.grid;

      // Update map depth display
      if (mapDepthEl) {
        mapDepthEl.textContent = message.newDepth;
      }

      // Update total kills display (reset for new map or keep cumulative?)
      // Keep cumulative kills across maps for now
      if (totalKillsEl && room.state.totalKills !== undefined) {
        totalKillsEl.textContent = room.state.totalKills;
      }

      // Show notification based on direction
      if (message.newDepth > 0) {
        statusEl.textContent = `🗺️ Map Depth ${message.newDepth} | More bots, tougher enemies!`;
      } else {
        statusEl.textContent = `🏠 Returned to starting map (Depth 0)`;
      }

      // Clear teleport animations for new map
      teleportAnimations = [];

      // Force re-render with new map
      render();
    });

    // Listen for game completion (reached max depth or other win condition)
    room.onMessage('gameCompleted', (message) => {
      console.log('🎊 Game completed!', message);

      if (message.triggerPlayer === mySessionId) {
        statusEl.textContent = `🎊 YOU WON! Total kills: ${message.totalKills}`;
      } else {
        statusEl.textContent = '🎊 Game completed by another player! Restarting...';
      }
    });

    // Listen for player hit notification
    room.onMessage('playerHit', (message) => {
      if (message.playerId === mySessionId) {
        statusEl.textContent = `💔 Hit! Lives: ${message.livesRemaining} | 🛡️ Invincible for ${message.invincibilitySeconds}s!`;
        console.log('You were hit! Respawned with invincibility');
      }
    });

    // Listen for game over
    room.onMessage('gameOver', (message) => {
      if (message.playerId === mySessionId) {
        statusEl.textContent = '☠️ GAME OVER! You ran out of lives.';
        console.log('Game Over - Out of lives');

        // Show game over modal with stats
        const finalDepthEl = document.getElementById('finalDepth');
        const finalKillsEl = document.getElementById('finalKills');
        const gameOverModal = document.getElementById('gameOverModal');

        finalDepthEl.textContent = room.state.currentMapDepth || 0;
        finalKillsEl.textContent = room.state.totalKills || 0;
        gameOverModal.classList.remove('hidden');
      }
    });

    // Listen for bot paths (debugging visualization)
    room.onMessage('botPaths', (message) => {
      botPaths = message;
    });

    // Setup debug panel event listeners
    document.getElementById('showBotPaths').addEventListener('change', (e) => {
      debugConfig.showBotPaths = e.target.checked;
    });

    document.getElementById('showBotStats').addEventListener('change', (e) => {
      debugConfig.showBotStats = e.target.checked;
    });

    // Update render on any state change
    room.onStateChange(() => {
      render();
    });

  } catch (e) {
    console.error('Failed to connect:', e);
    statusEl.textContent = 'Connection failed!';
  }
}

// Update debug panel bot statistics
function updateDebugPanel() {
  if (!debugConfig.panelOpen || !room || !room.state) return;
  
  const container = document.getElementById('botStatsContainer');
  
  // Get player's current map key for filtering
  const myPlayer = room.state.players.get(mySessionId);
  const playerMapKey = myPlayer ? `${myPlayer.currentMapDepth}_${myPlayer.currentMapSeed}` : null;
  
  // Count bots on current map
  let botsOnCurrentMap = 0;
  room.state.bots.forEach((bot) => {
    if (!playerMapKey || bot.mapKey === playerMapKey) {
      botsOnCurrentMap++;
    }
  });
  
  if (botsOnCurrentMap === 0) {
    container.innerHTML = '<div class="bot-stat-placeholder">No bots on this map</div>';
    return;
  }
  
  container.innerHTML = '';
  
  room.state.bots.forEach((bot, botId) => {
    // Filter: only show bots on player's current map
    if (playerMapKey && bot.mapKey !== playerMapKey) return;
    
    const path = botPaths[botId];
    const pathLength = path ? path.length : 0;
    const status = pathLength === 0 ? '❌ No Path' : '✅ Moving';
    const healthPercent = Math.round((bot.health / bot.maxHealth) * 100);
    
    const botStat = document.createElement('div');
    botStat.className = 'bot-stat-item';
    botStat.innerHTML = `
      <strong>${botId.slice(0, 10)}</strong><br>
      ${status} (${pathLength} waypoints)<br>
      Health: ${healthPercent}%
    `;
    container.appendChild(botStat);
  });
}

// Render the game
function render() {
  if (!room || dungeonGrid.length === 0) {
    console.log('⚠️ Render skipped - room:', !!room, 'gridLength:', dungeonGrid.length);
    return;
  }

  // Get current player position for camera
  const myPlayer = room.state.players.get(mySessionId);
  if (myPlayer) {
    // Force integer player position for camera calculations (prevents decimal camera positions)
    const playerTileX = Math.floor(myPlayer.x);
    const playerTileY = Math.floor(myPlayer.y);
    
    // Center camera on player
    cameraX = playerTileX - Math.floor(VIEWPORT_TILES_X / 2);
    cameraY = playerTileY - Math.floor(VIEWPORT_TILES_Y / 2);

    // Clamp camera to dungeon bounds
    cameraX = Math.max(0, Math.min(cameraX, dungeonWidth - VIEWPORT_TILES_X));
    cameraY = Math.max(0, Math.min(cameraY, dungeonHeight - VIEWPORT_TILES_Y));
    
    // Safety check for NaN (should never happen, but defensive programming)
    if (isNaN(cameraX) || isNaN(cameraY)) {
      console.error('❌ Invalid camera position detected, resetting to origin');
      console.error('   Player position:', myPlayer.x, myPlayer.y);
      cameraX = 0;
      cameraY = 0;
    }
  }

  // Clear canvas
  ctx.fillStyle = COLORS.WALL;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw tiles
  for (let y = 0; y < VIEWPORT_TILES_Y; y++) {
    for (let x = 0; x < VIEWPORT_TILES_X; x++) {
      // Force integer coordinates for array access (prevents decimal indices)
      const worldX = Math.floor(x + cameraX);
      const worldY = Math.floor(y + cameraY);

      if (worldY >= 0 && worldY < dungeonHeight && worldX >= 0 && worldX < dungeonWidth) {
        // Defensive check for undefined grid access
        if (!dungeonGrid[worldY] || dungeonGrid[worldY][worldX] === undefined) {
          console.warn(`⚠️ Invalid grid access at [${worldY}][${worldX}], camera: (${cameraX}, ${cameraY})`);
          continue;
        }
        const tile = dungeonGrid[worldY][worldX];

        let color = COLORS.WALL;
        switch (tile) {
          case 1: // FLOOR
            color = COLORS.FLOOR;
            break;
          case 2: // EXIT
            color = COLORS.EXIT;
            break;
          case 3: // SPAWN
            color = COLORS.SPAWN;
            break;
          case 4: // OBSTACLE
            color = COLORS.OBSTACLE;
            break;
          case 5: // TRANSPORT_INACTIVE (blue)
            color = COLORS.TRANSPORT_INACTIVE;
            break;
          case 6: // ENTRY_PORTAL (purple - go back)
            color = COLORS.ENTRY_PORTAL;
            break;
          case 7: // EXIT_PORTAL (green - go forward)
            color = COLORS.EXIT_PORTAL;
            break;
          case 8: // HOME_MARKER (gold - starting map)
            color = COLORS.HOME_MARKER;
            break;
        }

        ctx.fillStyle = color;
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

        // Draw grid lines
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  // Draw teleport destination animations (fading blue tiles)
  const currentTime = Date.now();
  teleportAnimations = teleportAnimations.filter(anim => {
    const elapsed = currentTime - anim.startTime;
    if (elapsed >= anim.duration) {
      return false; // Remove completed animations
    }

    // Calculate screen position
    const screenX = (anim.x - cameraX) * TILE_SIZE;
    const screenY = (anim.y - cameraY) * TILE_SIZE;

    // Only draw if on screen
    if (screenX >= 0 && screenX < canvas.width && screenY >= 0 && screenY < canvas.height) {
      // Calculate fade: start at 1.0, fade to 0
      const progress = elapsed / anim.duration;
      const alpha = 1.0 - progress;

      // Draw fading blue tile
      ctx.fillStyle = COLORS.TRANSPORT_INACTIVE;
      ctx.globalAlpha = alpha;
      ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);

      // Draw a pulsing border for extra visibility
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.globalAlpha = alpha * 0.8;
      ctx.strokeRect(screenX, screenY, TILE_SIZE, TILE_SIZE);

      // Reset alpha
      ctx.globalAlpha = 1.0;
    }

    return true; // Keep animation
  });

  // Draw bot paths (debugging visualization) - only if enabled
  if (debugConfig.showBotPaths) {
    Object.keys(botPaths).forEach((botId) => {
      const path = botPaths[botId];
      const bot = room.state.bots.get(botId);
      
      if (!path || path.length === 0 || !bot) return;
      
      // Draw path as a line with waypoint markers
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]); // Dashed line
      
      ctx.beginPath();
      
      // Start from bot's current position
      const pos = getInterpolatedBotPosition(bot);
      let startScreenX = (pos.x - cameraX) * TILE_SIZE + TILE_SIZE / 2;
      let startScreenY = (pos.y - cameraY) * TILE_SIZE + TILE_SIZE / 2;
      ctx.moveTo(startScreenX, startScreenY);
      
      // Draw line through all waypoints
      path.forEach((waypoint) => {
        const waypointScreenX = (waypoint.x - cameraX) * TILE_SIZE + TILE_SIZE / 2;
        const waypointScreenY = (waypoint.y - cameraY) * TILE_SIZE + TILE_SIZE / 2;
        ctx.lineTo(waypointScreenX, waypointScreenY);
      });
      
      ctx.stroke();
      ctx.setLineDash([]); // Reset to solid line
      
      // Draw waypoint markers
      path.forEach((waypoint, index) => {
        const waypointScreenX = (waypoint.x - cameraX) * TILE_SIZE + TILE_SIZE / 2;
        const waypointScreenY = (waypoint.y - cameraY) * TILE_SIZE + TILE_SIZE / 2;
        
        // Draw small circles for waypoints
        ctx.fillStyle = '#00ffff';
        ctx.beginPath();
        ctx.arc(waypointScreenX, waypointScreenY, 3, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw waypoint number for first few waypoints
        if (index < 5) {
          ctx.fillStyle = '#ffffff';
          ctx.font = '10px monospace';
          ctx.fillText((index + 1).toString(), waypointScreenX + 5, waypointScreenY - 5);
        }
      });
      
      ctx.globalAlpha = 1.0;
    });
  }

  // Draw bots with health bars (using interpolation for smooth movement)
  // Filter: only render bots on player's current map
  const myPlayerForBots = room.state.players.get(mySessionId);
  const playerMapKey = myPlayerForBots ? `${myPlayerForBots.currentMapDepth}_${myPlayerForBots.currentMapSeed}` : null;
  
  room.state.bots.forEach((bot) => {
    // Skip bots on other maps
    if (playerMapKey && bot.mapKey !== playerMapKey) return;
    
    // Get interpolated position for smooth rendering
    const pos = getInterpolatedBotPosition(bot);
    // Bot positions can be fractional for smooth interpolation (this is OK)
    // But we use integer camera position for consistent rendering
    const screenX = (pos.x - cameraX) * TILE_SIZE;
    const screenY = (pos.y - cameraY) * TILE_SIZE;

    // Only draw if on screen
    if (screenX >= 0 && screenX < canvas.width && screenY >= 0 && screenY < canvas.height) {
      // Draw bot as a red circle
      ctx.fillStyle = '#ff0000';
      ctx.beginPath();
      ctx.arc(
        screenX + TILE_SIZE / 2,
        screenY + TILE_SIZE / 2,
        TILE_SIZE / 3,
        0,
        Math.PI * 2
      );
      ctx.fill();

      // Draw outline
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw health bar above bot
      const barWidth = TILE_SIZE * 0.8;
      const barHeight = 3;
      const healthPercent = bot.health / bot.maxHealth;

      // Background (dark)
      ctx.fillStyle = '#333';
      ctx.fillRect(screenX + (TILE_SIZE - barWidth) / 2, screenY - 6, barWidth, barHeight);

      // Health (green to red gradient)
      ctx.fillStyle = healthPercent > 0.5 ? '#00ff00' : healthPercent > 0.25 ? '#ffff00' : '#ff0000';
      ctx.fillRect(screenX + (TILE_SIZE - barWidth) / 2, screenY - 6, barWidth * healthPercent, barHeight);

      // Draw bot debug stats overlay (if enabled)
      if (debugConfig.showBotStats) {
        const path = botPaths[bot.id];
        const pathLength = path ? path.length : 0;
        const status = pathLength === 0 ? '❌' : '✅';
        
        ctx.fillStyle = '#00ffff';
        ctx.font = '10px monospace';
        ctx.fillText(`${status} Path: ${pathLength}`, screenX, screenY - 15);
      }
    }
  });

  // Draw bullets with trail effect
  // Filter: only render bullets on player's current map (reuse playerMapKey from above)
  room.state.bullets.forEach((bullet) => {
    // Skip bullets on other maps
    if (playerMapKey && bullet.mapKey !== playerMapKey) return;
    
    const screenX = (bullet.x - cameraX) * TILE_SIZE;
    const screenY = (bullet.y - cameraY) * TILE_SIZE;

    // Only draw if on screen
    if (screenX >= 0 && screenX < canvas.width && screenY >= 0 && screenY < canvas.height) {
      // Draw bullet trail (short line behind bullet)
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(screenX - bullet.velocityX * 0.5, screenY - bullet.velocityY * 0.5);
      ctx.lineTo(screenX, screenY);
      ctx.stroke();
      ctx.globalAlpha = 1.0;

      // Draw bullet
      ctx.fillStyle = '#ffff00';
      ctx.beginPath();
      ctx.arc(screenX, screenY, 4, 0, Math.PI * 2);
      ctx.fill();

      // Add white outline for visibility
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  });

  // Draw players
  const now = Date.now();
  room.state.players.forEach((player, sessionId) => {
    const screenX = (player.x - cameraX) * TILE_SIZE;
    const screenY = (player.y - cameraY) * TILE_SIZE;

    // Only draw if on screen
    if (screenX >= 0 && screenX < canvas.width && screenY >= 0 && screenY < canvas.height) {
      const isMe = sessionId === mySessionId;
      const isInvincible = player.invincibleUntil > now;

      // Blinking effect during invincibility (blink every 150ms)
      if (isInvincible && Math.floor(now / 150) % 2 === 0) {
        // Skip rendering on alternate frames for blinking effect
        return;
      }

      // Draw player as a triangle (pointing in the direction they're facing)
      ctx.fillStyle = isMe ? COLORS.PLAYER : COLORS.OTHER_PLAYER;

      // Add glow effect if invincible
      if (isInvincible) {
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = 10;
      }

      ctx.save();

      // Translate to player center
      ctx.translate(screenX + TILE_SIZE / 2, screenY + TILE_SIZE / 2);

      // Rotate based on player angle (for aiming direction)
      ctx.rotate(player.angle);

      // Draw triangle pointing right (0 degrees)
      const size = TILE_SIZE / 2;
      ctx.beginPath();
      ctx.moveTo(size * 0.6, 0);           // Front point
      ctx.lineTo(-size * 0.4, -size * 0.5); // Back top
      ctx.lineTo(-size * 0.4, size * 0.5);  // Back bottom
      ctx.closePath();
      ctx.fill();

      // Draw outline
      ctx.strokeStyle = isInvincible ? '#00ffff' : '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.restore();

      // Reset shadow
      ctx.shadowBlur = 0;

      // Draw session ID above player
      if (!isMe) {
        ctx.fillStyle = '#fff';
        ctx.font = '10px monospace';
        ctx.fillText(
          sessionId.substr(0, 4),
          screenX + TILE_SIZE / 2 - 10,
          screenY - 8
        );
      }

      // Draw lives indicator for current player
      if (isMe && player.lives > 0) {
        ctx.fillStyle = '#ff0000';
        ctx.font = 'bold 10px monospace';
        ctx.fillText(
          `♥ ${player.lives}`,
          screenX + TILE_SIZE / 2 - 12,
          screenY + TILE_SIZE + 10
        );
      }

      // Draw invincibility timer
      if (isMe && isInvincible) {
        const timeLeft = Math.ceil((player.invincibleUntil - now) / 1000);
        ctx.fillStyle = '#00ffff';
        ctx.font = 'bold 10px monospace';
        ctx.fillText(
          `🛡️ ${timeLeft}s`,
          screenX + TILE_SIZE / 2 - 12,
          screenY - 10
        );

        // Update status message with countdown
        statusEl.textContent = `🛡️ Invincible for ${timeLeft}s! Lives: ${player.lives}`;
      }
    }
  });

  // Update debug panel stats
  updateDebugPanel();
}

// Handle keyboard input
const keys = {};
document.addEventListener('keydown', (e) => {
  keys[e.key] = true;

  if (!room) return;

  const myPlayer = room.state.players.get(mySessionId);
  if (!myPlayer || myPlayer.lives <= 0) return;

  let direction = null;

  if (keys['w'] || keys['W'] || keys['ArrowUp']) {
    direction = 'up';
  } else if (keys['s'] || keys['S'] || keys['ArrowDown']) {
    direction = 'down';
  } else if (keys['a'] || keys['A'] || keys['ArrowLeft']) {
    direction = 'left';
  } else if (keys['d'] || keys['D'] || keys['ArrowRight']) {
    direction = 'right';
  }

  // Shoot with spacebar
  if (e.key === ' ' || e.key === 'Spacebar') {
    console.log('🔫 Shooting bullet at angle:', myPlayer.angle.toFixed(2));
    room.send('shoot', { angle: myPlayer.angle });
    e.preventDefault();
    return;
  }

  if (direction) {
    room.send('move', { direction });
    e.preventDefault();
  }
});

document.addEventListener('keyup', (e) => {
  keys[e.key] = false;
});

// Mouse movement for aiming - track mouse position and update player angle
// Only enable on non-touch devices to prevent conflicts with touch controls
let lastAngleUpdate = 0;
const ANGLE_UPDATE_THROTTLE = 50; // Update angle max every 50ms

if (!isTouchDevice) {
  canvas.addEventListener('mousemove', (e) => {
    if (!room || !mySessionId) return;

    const myPlayer = room.state.players.get(mySessionId);
    if (!myPlayer || myPlayer.lives <= 0) return;

    // Throttle angle updates to reduce network traffic
    const now = Date.now();
    if (now - lastAngleUpdate < ANGLE_UPDATE_THROTTLE) return;
    lastAngleUpdate = now;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Calculate angle from player to mouse
    const playerScreenX = (myPlayer.x - cameraX) * TILE_SIZE + TILE_SIZE / 2;
    const playerScreenY = (myPlayer.y - cameraY) * TILE_SIZE + TILE_SIZE / 2;
    const angle = Math.atan2(mouseY - playerScreenY, mouseX - playerScreenX);

    // Send angle update to server
    room.send('updateAngle', { angle });
  });
}

// Debug command to show network stats
window.showStats = function() {
  const uptimeSeconds = room ? Math.floor((Date.now() - room.sessionId.length) / 1000) : 0;
  const bytesPerSecond = uptimeSeconds > 0 ? (bytesReceived / uptimeSeconds).toFixed(2) : 0;

  console.log('\n📈 NETWORK & MEMORY STATS:');
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📦 Initial state size: ${initialStateSizeBytes} bytes (${(initialStateSizeBytes / 1024).toFixed(2)} KB)`);
  console.log(`📨 Messages received: ${messagesReceived}`);
  console.log(`📥 Total bytes received: ${bytesReceived} bytes (${(bytesReceived / 1024).toFixed(2)} KB)`);
  console.log(`📊 Bandwidth usage: ~${bytesPerSecond} bytes/sec`);

  if (performance.memory) {
    const usedMB = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2);
    const totalMB = (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(2);
    const limitMB = (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2);
    console.log(`💾 JS Heap: ${usedMB} MB / ${totalMB} MB (limit: ${limitMB} MB)`);
  } else {
    console.log(`💾 Memory API not available (try Chrome with --enable-precise-memory-info flag)`);
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  console.log(`💡 Tip: Run showStats() anytime to see updated stats`);
};

console.log(`\n💡 TIP: Type showStats() in the console to see network and memory usage!\n`);

// Auto-connect to room from sessionStorage (coming from lobby page)
async function autoConnectFromLobby() {
  const roomId = sessionStorage.getItem('roomId');
  const roomName = sessionStorage.getItem('roomName');
  const playerName = sessionStorage.getItem('playerName');
  const isNewRoom = sessionStorage.getItem('isNewRoom') === 'true';
  
  // Clear session storage
  sessionStorage.removeItem('roomId');
  sessionStorage.removeItem('roomName');
  sessionStorage.removeItem('playerName');
  sessionStorage.removeItem('isNewRoom');
  
  // Need either roomId (to join) or roomName (to create)
  if (!playerName || (!roomId && !roomName)) {
    console.error('Missing room connection info, redirecting to lobby...');
    returnToLobby();
    return;
  }
  
  try {
    if (isNewRoom && roomName) {
      // Create a new room
      console.log('Creating new room:', roomName, 'as', playerName);
      await connect(roomName, true, playerName);
    } else if (roomId) {
      // Join existing room by ID
      console.log('Joining room:', roomId, 'as', playerName);
      await connect(roomId, false, playerName);
    } else {
      console.error('Invalid room configuration');
      returnToLobby();
    }
  } catch (error) {
    console.error('Failed to connect to room:', error);
    alert('Failed to connect to room. Returning to lobby.');
    returnToLobby();
  }
}

// Return to lobby function
window.returnToLobby = function() {
  // Disconnect from current room if connected
  if (room) {
    room.leave();
    room = null;
    mySessionId = null;
    roomHostId = null;
  }

  // Reset game state
  dungeonGrid = [];
  activeTransports = [];
  teleportAnimations = [];
  muzzleFlashes = [];
  damageEffects = [];
  botPaths = {};
  isHost = false;
  gameStarted = false;

  // Redirect to lobby (index.html)
  window.location.href = '/';
};

// ==========================================
// WAITING ROOM FUNCTIONS
// ==========================================

// Show the waiting room overlay
function showWaitingRoom() {
  document.getElementById('waitingRoomOverlay').classList.remove('hidden');
  updateWaitingRoomUI();
}

// Hide the waiting room overlay
function hideWaitingRoom() {
  document.getElementById('waitingRoomOverlay').classList.add('hidden');
}

// Update the waiting room UI based on current state
function updateWaitingRoomUI() {
  if (!room || !room.state) return;

  // Update room name
  const roomName = room.state.roomName || 'Unnamed Room';
  document.getElementById('waitingRoomName').textContent = roomName;

  // Update player count
  const playerCount = room.state.players ? room.state.players.size : 0;
  document.getElementById('waitingPlayerCount').textContent = playerCount;

  // Update player list
  updateWaitingPlayersList();

  // Show/hide host controls vs waiting message
  const hostControls = document.getElementById('hostControls');
  const waitingMessage = document.getElementById('waitingMessage');

  if (isHost) {
    hostControls.classList.remove('hidden');
    waitingMessage.classList.add('hidden');
  } else {
    hostControls.classList.add('hidden');
    waitingMessage.classList.remove('hidden');
  }
}

// Update the player list in the waiting room
function updateWaitingPlayersList() {
  if (!room || !room.state || !room.state.players) return;

  const container = document.getElementById('waitingPlayersList');
  
  if (room.state.players.size === 0) {
    container.innerHTML = '<div style="color: #666; font-style: italic;">Waiting for players...</div>';
    return;
  }

  let html = '';
  room.state.players.forEach((player, sessionId) => {
    const isYou = sessionId === mySessionId;
    const isPlayerHost = sessionId === room.state.hostSessionId;
    
    let classes = 'waiting-player-item';
    let badges = '';
    
    if (isPlayerHost) {
      badges += '<span class="waiting-player-host">★ Host</span> ';
    }
    if (isYou) {
      badges += '<span class="waiting-player-you">(You)</span>';
    }

    html += `
      <div class="${classes}">
        ${player.name || 'Unknown'} ${badges}
      </div>
    `;
  });

  container.innerHTML = html;
}

// Start the game (only host can call this)
window.startGame = function() {
  if (!room || !isHost) {
    console.log('Cannot start game: not host or not connected');
    return;
  }

  console.log('🎮 Starting game...');
  room.send('startGame', {});
};

// Handle game started event
function onGameStarted(message) {
  console.log('🎮 Game started!', message);
  gameStarted = true;
  hideWaitingRoom();
  statusEl.textContent = `Game started! Explore the dungeon and kill bots!`;
}

// Handle host changed event
function onHostChanged(message) {
  console.log('👑 Host changed:', message);
  roomHostId = message.newHostId;
  isHost = (message.newHostId === mySessionId);
  
  if (isHost) {
    statusEl.textContent = 'You are now the host! Click START GAME when ready.';
  }
  
  updateWaitingRoomUI();
}

// Toggle debug panel
window.toggleDebugPanel = function() {
  debugConfig.panelOpen = !debugConfig.panelOpen;
  const panel = document.getElementById('debugPanel');
  
  if (debugConfig.panelOpen) {
    panel.classList.add('visible');
  } else {
    panel.classList.remove('visible');
  }
};

// Check for room parameter in URL and pre-fill modal
function checkForRoomParameter() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  
  if (roomParam) {
    console.log('🔗 Room link detected:', roomParam);
    // Pre-fill the room name input
    document.getElementById('roomName').value = roomParam;
    
    // Show custom message in modal
    const modalTitle = document.querySelector('.modal-title');
    modalTitle.textContent = 'JOIN SHARED ROOM';
    
    // Add info message
    const modalContent = document.querySelector('.modal-content');
    const infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'margin: 10px 0; padding: 10px; background: rgba(0, 255, 0, 0.1); border: 1px solid #00ff00; border-radius: 5px; font-size: 14px;';
    infoDiv.innerHTML = `<strong>Room ID:</strong> ${roomParam}<br>Click "Join Game" to connect!`;
    modalContent.insertBefore(infoDiv, modalContent.querySelector('.input-group'));
    
    // Auto-focus the Join Game button
    setTimeout(() => {
      const joinBtn = document.querySelector('.button-group button:last-child');
      if (joinBtn) joinBtn.focus();
    }, 100);
  }
}

// Copy room link to clipboard
window.copyRoomLink = function() {
  if (!room || !room.roomId) {
    alert('Not connected to a room yet!');
    return;
  }

  // Room link goes to lobby page with room parameter
  const roomLink = `${window.location.origin}/?join=${room.roomId}`;
  
  // Modern clipboard API
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(roomLink)
      .then(() => {
        showCopySuccess();
      })
      .catch(err => {
        console.error('Failed to copy:', err);
        fallbackCopyToClipboard(roomLink);
      });
  } else {
    // Fallback for older browsers
    fallbackCopyToClipboard(roomLink);
  }
};

// Show success message
function showCopySuccess() {
  // Side panel status
  const status = document.getElementById('copyLinkStatus');
  const btn = document.getElementById('copyRoomLinkBtn');
  
  if (status) status.style.display = 'block';
  if (btn) btn.textContent = '✓ Copied!';
  
  // Waiting room status
  const waitingStatus = document.getElementById('waitingCopyStatus');
  const waitingBtn = document.getElementById('waitingCopyLinkBtn');
  
  if (waitingStatus) {
    waitingStatus.classList.remove('show');
    // Force reflow to restart animation
    void waitingStatus.offsetWidth;
    waitingStatus.classList.add('show');
  }
  if (waitingBtn) waitingBtn.textContent = '✓ Copied!';
  
  setTimeout(() => {
    if (status) status.style.display = 'none';
    if (btn) btn.textContent = 'Copy Room Link';
    if (waitingBtn) waitingBtn.textContent = 'Copy Invite Link';
  }, 2000);
}

// Fallback copy method for older browsers
function fallbackCopyToClipboard(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    const successful = document.execCommand('copy');
    if (successful) {
      showCopySuccess();
    } else {
      alert('Failed to copy. Please copy manually: ' + text);
    }
  } catch (err) {
    alert('Failed to copy. Please copy manually: ' + text);
  }
  
  document.body.removeChild(textArea);
}

// Leave room function
window.leaveRoom = function() {
  if (!room) {
    alert('Not connected to a room!');
    return;
  }

  if (confirm('Are you sure you want to leave this room?')) {
    returnToLobby();
  }
};

// Update panel display when connected
function updatePanelDisplay() {
  if (!room || !room.state) return;

  // Update room name
  const roomName = room.state.roomName || 'Unnamed Room';
  document.getElementById('panelRoomName').textContent = roomName;

  // Update room ID
  document.getElementById('panelRoomId').textContent = room.roomId || 'Unknown';
  
  // Update player count
  const playerCount = room.state.players ? room.state.players.size : 0;
  document.getElementById('panelPlayerCount').textContent = playerCount;
  document.getElementById('panelPlayersCount').textContent = playerCount;
  
  // Update host display
  if (roomHostId && room.state.players) {
    const hostPlayer = room.state.players.get(roomHostId);
    if (hostPlayer) {
      const isHost = roomHostId === mySessionId;
      const hostDisplay = isHost ? 'You' : hostPlayer.name;
      document.getElementById('panelRoomHost').textContent = hostDisplay;
    }
  }
  
  // Update players list
  updatePlayersList();
  
  // Enable buttons
  document.getElementById('copyRoomLinkBtn').disabled = false;
  document.getElementById('leaveRoomBtn').disabled = false;
}

// Update players list in panel
function updatePlayersList() {
  if (!room || !room.state || !room.state.players) return;

  const container = document.getElementById('playersList');
  
  if (room.state.players.size === 0) {
    container.innerHTML = '<div style="color: #666; font-style: italic;">No players yet</div>';
    return;
  }

  let html = '';
  room.state.players.forEach((player, sessionId) => {
    const isYou = sessionId === mySessionId;
    const isHost = sessionId === roomHostId;
    
    html += `
      <div class="player-card">
        <div class="player-card-header">
          ${player.name || 'Unknown'} ${isYou ? '(You)' : ''} ${isHost ? '⭐' : ''}
        </div>
        <div class="player-card-stats">
          Lives: ${'♥'.repeat(player.lives || 0)}<br>
          Kills: ${player.score || 0}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// Activity feed management
const activityMessages = [];
const MAX_ACTIVITY_MESSAGES = 10;

function addActivityMessage(message) {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  
  activityMessages.unshift({
    time: timestamp,
    text: message.text,
    type: message.type || 'default'
  });

  // Keep only last 10 messages
  if (activityMessages.length > MAX_ACTIVITY_MESSAGES) {
    activityMessages.pop();
  }

  updateActivityFeed();
}

function updateActivityFeed() {
  const container = document.getElementById('activityFeed');
  
  if (activityMessages.length === 0) {
    container.innerHTML = '<div style="color: #666; font-style: italic;">No activity yet</div>';
    return;
  }

  const html = activityMessages.map(msg => `
    <div class="activity-message">
      <span class="activity-time">[${msg.time}]</span>
      <span class="activity-${msg.type}">${msg.text}</span>
    </div>
  `).join('');

  container.innerHTML = html;
  
  // Auto-scroll to top (newest message)
  container.scrollTop = 0;
}

// Auto-connect when page loads (if coming from lobby)
autoConnectFromLobby();

// Initialize touch controls if on touch device
if (isTouchDevice) {
  initTouchControls();
  startTouchMoveLoop();
}

// Render loop
setInterval(render, 1000 / 30); // 30 FPS
