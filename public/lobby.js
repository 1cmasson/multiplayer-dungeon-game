// Lobby JavaScript for Multiplayer Dungeon Shooter

const client = new Colyseus.Client('ws://localhost:2567');
const SERVER_URL = 'http://localhost:2567';
let roomBrowserInterval = null;
let lastRoomsHash = ''; // Track room list to avoid unnecessary re-renders
let isFirstLoad = true;

// Load player name from localStorage or generate new one
function loadPlayerName() {
  const saved = localStorage.getItem('playerName');
  if (saved) {
    document.getElementById('playerName').value = saved;
  } else {
    const generated = generatePlayerName();
    document.getElementById('playerName').value = generated;
  }
}

function savePlayerName(name) {
  localStorage.setItem('playerName', name);
}

function generatePlayerName() {
  const adjectives = ['Swift', 'Brave', 'Silent', 'Mystic', 'Dark', 'Mighty', 'Quick', 'Phantom', 'Thunder', 'Shadow'];
  const nouns = ['Hunter', 'Warrior', 'Ranger', 'Knight', 'Rogue', 'Mage', 'Archer', 'Wizard', 'Assassin', 'Paladin'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 1000);
  return `${adj}${noun}${num}`;
}

function getPlayerName() {
  let name = document.getElementById('playerName').value.trim();
  if (!name) {
    name = generatePlayerName();
    document.getElementById('playerName').value = name;
  }
  savePlayerName(name);
  return name;
}

// Create a new game room
async function createGame() {
  const playerName = getPlayerName();
  const roomName = document.getElementById('roomName').value.trim() || 'Unnamed Room';
  
  // Don't create the room here - let game.html do it
  // This avoids the room being disposed when we navigate away
  sessionStorage.setItem('roomName', roomName);
  sessionStorage.setItem('playerName', playerName);
  sessionStorage.setItem('isNewRoom', 'true');
  
  // Redirect to game page - it will create the room
  window.location.href = 'game.html';
}

// Join an existing room
async function joinRoom(roomId) {
  const playerName = getPlayerName();
  
  // Don't join the room here - let game.html do it
  // This avoids connection issues when we navigate away
  sessionStorage.setItem('roomId', roomId);
  sessionStorage.setItem('playerName', playerName);
  sessionStorage.setItem('isNewRoom', 'false');
  
  // Redirect to game page - it will join the room
  window.location.href = 'game.html';
}

// Refresh the room list
async function refreshRoomList() {
  const roomsListEl = document.getElementById('roomsList');
  
  try {
    // Show loading state only on first load
    if (isFirstLoad) {
      roomsListEl.innerHTML = '<div class="loading-spinner">Loading rooms...</div>';
    }
    
    // Use HTTP API to get available rooms
    const response = await fetch(`${SERVER_URL}/api/rooms/dungeon`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const rooms = await response.json();
    
    // Create a hash of the current rooms to detect changes
    const currentHash = JSON.stringify(rooms.map(r => ({
      id: r.roomId,
      clients: r.clients,
      metadata: r.metadata
    })));
    
    // Only update DOM if rooms have changed
    if (currentHash === lastRoomsHash && !isFirstLoad) {
      return; // No changes, skip re-render
    }
    
    lastRoomsHash = currentHash;
    isFirstLoad = false;
    
    if (!rooms || rooms.length === 0) {
      roomsListEl.innerHTML = `
        <div class="empty-state">
          No active rooms found.<br>
          Create a new room to get started!
        </div>
      `;
      return;
    }
    
    // Display rooms
    let html = '';
    for (const room of rooms) {
      const metadata = room.metadata || {};
      const roomName = metadata.roomName || 'Unnamed Room';
      const hostName = metadata.hostName || 'Unknown';
      const currentLevel = metadata.currentLevel || 1;
      const totalLevels = metadata.totalLevels || 5;
      const currentLevelKills = metadata.currentLevelKills || 0;
      const killsNeededForNextLevel = metadata.killsNeededForNextLevel || 10;
      
      html += `
        <div class="room-item" onclick="joinRoom('${room.roomId}')">
          <div class="room-item-header">
            <div class="room-item-title">${escapeHtml(roomName)}</div>
            <div class="room-item-players">${room.clients}/${room.maxClients} Players</div>
          </div>
          <div class="room-item-info">
            <div>Host: ${escapeHtml(hostName)}</div>
            <div>Level: ${currentLevel}/${totalLevels} | Kills: ${currentLevelKills}/${killsNeededForNextLevel}</div>
          </div>
          <div class="room-item-id">Room ID: ${room.roomId}</div>
          <button class="join-btn" onclick="event.stopPropagation(); joinRoom('${room.roomId}')">
            Join Room
          </button>
        </div>
      `;
    }
    
    roomsListEl.innerHTML = html;
    
  } catch (error) {
    console.error('[Lobby] Failed to fetch rooms:', error);
    // Only show error on first load or if we had rooms before
    if (isFirstLoad || lastRoomsHash !== '') {
      roomsListEl.innerHTML = `
        <div class="empty-state">
          <span style="color: #ff6600;">Server connection issue</span><br>
          Make sure the game server is running on port 2567.<br>
          <button onclick="refreshRoomList()" style="margin-top: 10px;">Try Again</button>
        </div>
      `;
      lastRoomsHash = '';
    }
    isFirstLoad = false;
  }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize lobby
function initLobby() {
  loadPlayerName();
  
  // Check for join parameter in URL
  const urlParams = new URLSearchParams(window.location.search);
  const joinRoomId = urlParams.get('join');
  
  if (joinRoomId) {
    // Auto-join the room
    console.log('Auto-joining room from URL:', joinRoomId);
    joinRoom(joinRoomId);
    return;
  }
  
  refreshRoomList();
  
  // Auto-refresh room list every 3 seconds
  roomBrowserInterval = setInterval(refreshRoomList, 3000);
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (roomBrowserInterval) {
    clearInterval(roomBrowserInterval);
  }
});

// Initialize when page loads
window.addEventListener('DOMContentLoaded', initLobby);
