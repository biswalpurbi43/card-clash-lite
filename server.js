const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static("public"));

const rooms = new Map();
const COLORS = ["red", "blue", "green", "yellow"];

function makeDeck() {
  const  deck = [];
  for (const color of COLORS) {
    deck.push({ color, value: "0" });
    for (let n = 1; n <= 9; n++) {
      deck.push({ color, value: String(n) }, { color, value: String(n) });
    }
    for (let i = 0; i < 2; i++) {
      deck.push({ color, value: "Skip" }, { color, value: "Reverse" });
    }
  }
  return shuffle(deck);
}
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
function code() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}
function current(room) { return room.players[room.turn]; }
function nextIndex(room, steps = 1) {
  return (room.turn + room.direction * steps + room.players.length * 10) % room.players.length;
}
function top(room) { return room.discard[room.discard.length - 1]; }
function playable(card, topCard) {
  return card.color === topCard.color || card.value === topCard.value;
}
function drawOne(room, player) {
  if (!room.deck.length) {
    if (room.discard.length > 1) {
      const keep = room.discard.pop();
      room.deck = shuffle(room.discard.splice(0));
      room.discard = [keep];
    } else return null;
  }
  const card = room.deck.pop();
  player.hand.push(card);
  return card;
}
function publicState(room, socketId) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    players: room.players.map((p, i) => ({
      id: p.id, name: p.name, count: p.hand.length,
      ready: !!p.ready, isHost: p.id === room.hostId,
      isCurrent: room.status === "playing" && i === room.turn
    })),
    hand: room.players.find(p => p.id === socketId)?.hand || [],
    discard: room.discard,
    deckCount: room.deck.length,
    direction: room.direction,
    turnId: room.status === "playing" ? current(room).id : null,
    turnName: room.status === "playing" ? current(room).name : null,
    winner: room.winner,
    message: room.message
  };
}
function emitRoom(room) {
  for (const p of room.players) io.to(p.id).emit("state", publicState(room, p.id));
}
function sendError(socket, msg) { socket.emit("notice", msg); }

function startGame(room) {
  if (room.players.length < 2 || room.players.length > 8) return false;
  room.deck = makeDeck();
  room.discard = [];
  room.players.forEach(p => { p.hand = []; p.ready = true; });
  for (let i = 0; i < 5; i++) room.players.forEach(p => p.hand.push(room.deck.pop()));
  let starter = room.deck.pop();
  while (starter.value === "Skip" || starter.value === "Reverse") {
    room.deck.unshift(starter);
    starter = room.deck.pop();
  }
  room.discard.push(starter);
  room.turn = Math.floor(Math.random() * room.players.length);
  room.direction = 1;
  room.status = "playing";
  room.winner = null;
  room.message = `${room.players[room.turn].name}'s turn`;
  return true;
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name }) => {
    const playerName = String(name || "Player").trim().slice(0, 18) || "Player";
    let roomCode;
    do { roomCode = code(); } while (rooms.has(roomCode));
    const room = {
      code: roomCode, hostId: socket.id, players: [{ id: socket.id, name: playerName, hand: [], ready: true }],
      status: "lobby", deck: [], discard: [], turn: 0, direction: 1, winner: null, message: "Waiting for players"
    };
    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    emitRoom(room);
  });

  socket.on("joinRoom", ({ code: rawCode, name }) => {
    const roomCode = String(rawCode || "").trim().toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) return sendError(socket, "Room code not found. Check it and try again.");
    if (room.status !== "lobby") return sendError(socket, "This game has already started.");
    if (room.players.length >= 8) return sendError(socket, "This room is full (8 players maximum).");
    const playerName = String(name || "Player").trim().slice(0, 18) || "Player";
    if (room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase())) {
      return sendError(socket, "That nickname is already in this room. Choose another.");
    }
    room.players.push({ id: socket.id, name: playerName, hand: [], ready: true });
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    emitRoom(room);
  });

  socket.on("startGame", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (socket.id !== room.hostId) return sendError(socket, "Only the host can start the game.");
    if (room.players.length < 2) return sendError(socket, "Invite at least one more player to start.");
    startGame(room);
    emitRoom(room);
  });

  socket.on("playCard", ({ cardIndex }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "playing") return;
    const player = current(room);
    if (player.id !== socket.id) return sendError(socket, "It's not your turn yet.");
    const index = Number(cardIndex);
    const card = player.hand[index];
    if (!card || !playable(card, top(room))) return sendError(socket, "That card can't be played on the current card.");
    player.hand.splice(index, 1);
    room.discard.push(card);

    if (player.hand.length === 0) {
      room.status = "finished";
      room.winner = player.name;
      room.message = `${player.name} wins!`;
      emitRoom(room);
      return;
    }

    if (card.value === "Reverse") {
      if (room.players.length === 2) {
        room.turn = room.turn; // Reverse skips the opponent; same player takes another turn
      } else {
        room.direction *= -1;
        room.turn = nextIndex(room, 1);
      }
    } else if (card.value === "Skip") {
      room.turn = nextIndex(room, 2);
    } else {
      room.turn = nextIndex(room, 1);
    }
    room.message = `${current(room).name}'s turn`;
    emitRoom(room);
  });

  socket.on("drawCard", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "playing") return;
    const player = current(room);
    if (player.id !== socket.id) return sendError(socket, "It's not your turn yet.");
    const card = drawOne(room, player);
    room.turn = nextIndex(room, 1);
    room.message = card ? `${player.name} drew a card. ${current(room).name}'s turn` : `Deck is empty. ${current(room).name}'s turn`;
    emitRoom(room);
  });

  socket.on("playAgain", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "finished") return;
    if (socket.id !== room.hostId) return sendError(socket, "Only the host can start another game.");
    startGame(room);
    emitRoom(room);
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (!room.players.length) {
      rooms.delete(roomCode);
      return;
    }
    if (room.hostId === socket.id) room.hostId = room.players[0].id;
    if (room.status === "playing" && room.players.length < 2) {
      room.status = "lobby";
      room.message = "Waiting for another player";
      room.players.forEach(p => p.hand = []);
    } else if (room.status === "playing") {
      const oldTurn = room.turn;
      room.turn = Math.min(oldTurn, room.players.length - 1);
      room.message = `${current(room).name}'s turn`;
    }
    emitRoom(room);
  });
});

server.listen(PORT, () => console.log(`Card Clash Lite running on http://localhost:${PORT}`));
