const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {}; // roomId -> { password, users: [] }

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("join-room", ({ roomId, password }) => {
    const room = rooms[roomId];

    if (room && room.password !== password) {
      socket.emit("join-error", "Wrong password!");
      return;
    }

    if (!room) rooms[roomId] = { password, users: [] };
    const users = rooms[roomId].users;

    if (users.length >= 2) {
      socket.emit("join-error", "Room full!");
      return;
    }

    users.push(socket.id);
    socket.join(roomId);
    socket.emit("joined", roomId);

    const other = users.find((id) => id !== socket.id);
    if (other) socket.emit("other-user", other);
    socket.to(roomId).emit("user-joined", socket.id);
  });

  socket.on("offer", (payload) => io.to(payload.target).emit("offer", payload));
  socket.on("answer", (payload) => io.to(payload.target).emit("answer", payload));
  socket.on("ice-candidate", (payload) => io.to(payload.target).emit("ice-candidate", payload));

  socket.on("chat-message", ({ roomId, text, ts }) => {
    socket.to(roomId).emit("chat-message", { text, ts });
  });

  socket.on("wb-draw", ({ roomId, stroke }) => socket.to(roomId).emit("wb-draw", { stroke }));
  socket.on("wb-clear", ({ roomId }) => socket.to(roomId).emit("wb-clear"));

  socket.on("hang-up", () => {
    socket.rooms.forEach((r) => socket.to(r).emit("peer-hang-up"));
  });

  socket.on("disconnect", () => {
    Object.keys(rooms).forEach((r) => {
      rooms[r].users = rooms[r].users.filter((id) => id !== socket.id);
      if (rooms[r].users.length === 0) delete rooms[r];
      else socket.to(r).emit("peer-left");
    });
  });
});

server.listen(5000, () => console.log("Signaling server running on 5000"));
