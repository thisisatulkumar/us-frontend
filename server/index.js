const express = require('express');
const http = require('http');

const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*'
    }
});

app.get('/', (req, res) => {
    res.send('Signaling server is running');
});

io.on('connection', socket => {
    console.log('Socket connected: ', socket.id);

    socket.on('join-room', ({ roomId }) => {
        socket.join(roomId);

        const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
        const other = clients.find(id => id !== socket.id);
        if (other) {
            socket.emit('other-user', other);
            socket.to(other).emit('user-joined', socket.id);
        }
    });

    socket.on('offer', payload => {
        io.to(payload.target).emit('offer', {
            sdp: payload.sdp,
            caller: socket.id
        });
    });

    socket.on('answer', payload => {
        io.to(payload.target).emit('answer', {
            sdp: payload.sdp,
            caller: socket.id
        });
    });

    socket.on('ice-candidate', payload => {
        io.to(payload.target).emit('ice-candidate', {
            candidate: payload.candidate,
            from: socket.id
        });
    });

    socket.on('chat', payload => {
        socket.to(payload.roomId).emit('chat', payload);
    });

    socket.on('whiteboard', payload => {
        socket.to(payload.roomId).emit('whiteboard', payload);
    });

    socket.on('disconnect', () => {
        console.log('Socket disconnected: ', socket.id);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Signaling server is running on port ${PORT}`);
});
