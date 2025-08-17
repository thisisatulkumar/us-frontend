"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

import {
    Mic,
    MicOff,
    Video,
    VideoOff,
    ScreenShare,
    ScreenShareOff,
    SquareX,
    Presentation
} from 'lucide-react';
import { ImPhoneHangUp } from "react-icons/im";

const SIGNALING_SERVER = "https://us-backend-production.up.railway.app/";
const ICE_SERVERS: RTCIceServer[] = [
    {
        urls: "stun:stun.relay.metered.ca:80",
    },
    {
        urls: "turn:global.relay.metered.ca:80",
        username: "c486d08eaed0e8b224aa0a93",
        credential: "KOsqhw8Rsgbd1t5F",
    },
    {
        urls: "turn:global.relay.metered.ca:80?transport=tcp",
        username: "c486d08eaed0e8b224aa0a93",
        credential: "KOsqhw8Rsgbd1t5F",
    },
    {
        urls: "turn:global.relay.metered.ca:443",
        username: "c486d08eaed0e8b224aa0a93",
        credential: "KOsqhw8Rsgbd1t5F",
    },
    {
        urls: "turns:global.relay.metered.ca:443?transport=tcp",
        username: "c486d08eaed0e8b224aa0a93",
        credential: "KOsqhw8Rsgbd1t5F",
    },
];


type Stroke = { points: { x: number; y: number }[]; color: string; size: number };
type ChatMessage = { from: "me" | "peer"; text: string; ts: number };

export default function Home() {
    const [roomId, setRoomId] = useState("");
    const [password, setPassword] = useState("");
    const [joined, setJoined] = useState(false);
    const [audioEnabled, setAudioEnabled] = useState(true);
    const [videoEnabled, setVideoEnabled] = useState(true);
    const [sharing, setSharing] = useState(false);
    const [wbOpen, setWbOpen] = useState(false);
    const [chatInput, setChatInput] = useState("");
    const [chatLog, setChatLog] = useState<ChatMessage[]>([]);

    const [wbTool, setWbTool] = useState<"pen" | "eraser">("pen");
    const [wbColor, setWbColor] = useState("#cfd8dc");
    const [wbSize, setWbSize] = useState(3);
    const [wbPosition, setWbPosition] = useState({ x: 100, y: 100 });
    const [wbSizeBox, setWbSizeBox] = useState({ width: 800, height: 600 });

    const socketRef = useRef<Socket | null>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const screenStreamRef = useRef<MediaStream | null>(null);
    const targetSocketRef = useRef<string | null>(null);
    const bufferedIceRef = useRef<RTCIceCandidateInit[]>([]);

    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef(false);
    const strokeRef = useRef<Stroke | null>(null);

    const chatContainerRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef({ dragging: false, offsetX: 0, offsetY: 0 });
    const resizeRef = useRef({ resizing: false, startX: 0, startY: 0, startW: 0, startH: 0 });

    useEffect(() => {
        const socket = io(SIGNALING_SERVER);
        socketRef.current = socket;

        // Receive and draw remote stroke
        socket.on("wb-draw", (data: { stroke: Stroke }) => {
            drawStroke(data.stroke);
            // Also save to autosave for persistence
            const saved = localStorage.getItem("wb-autosave");
            const strokes: Stroke[] = saved ? JSON.parse(saved) : [];
            strokes.push(data.stroke);
            localStorage.setItem("wb-autosave", JSON.stringify(strokes));
        });

        // Receive and handle remote clear
        socket.on("wb-clear", () => {
            const c = canvasRef.current;
            if (c) {
                c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
            }
            localStorage.removeItem("wb-autosave");
        });

        // --- Add this inside your existing useEffect where socket is defined ---
        socket.on("chat-message", (data: { text: string; ts: number }) => {
            setChatLog(prev => [...prev, { from: "peer", text: data.text, ts: data.ts }]);
            setTimeout(() => {
                chatContainerRef.current?.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: "smooth" });
            }, 50);
        });


        // Join room handling
        socket.on("other-user", (id: string) => {
            console.log("Other user in room:", id);
            targetSocketRef.current = id;
            if (!pcRef.current) createPeer(true, id);
        });

        socket.on("offer", async (data: any) => {
            console.log("Received offer from", data.caller);
            targetSocketRef.current = data.caller;
            if (!pcRef.current) await createPeer(false, data.caller);

            if (pcRef.current) {
                await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
                flushBufferedIce();
                const answer = await pcRef.current.createAnswer();
                await pcRef.current.setLocalDescription(answer);
                socket.emit("answer", { target: data.caller, sdp: pcRef.current.localDescription });
            }
        });

        socket.on("answer", async (data: any) => {
            console.log("Received answer");
            if (pcRef.current && data.sdp) {
                await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
                flushBufferedIce();
            }
        });

        socket.on("ice-candidate", async (data: any) => {
            if (!data.candidate) return;
            if (pcRef.current) {
                try { await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate)); }
                catch (e) { console.warn("Failed adding ICE candidate", e); }
            } else {
                bufferedIceRef.current.push(data.candidate);
            }
        });

        socket.on("hang-up", () => {
            console.log("Peer hung up");
            stopEverything();
            alert("Peer has hung up");
        });

        return () => { socket.disconnect(); }
    }, []);

    useEffect(() => {
        if (wbOpen && canvasRef.current) {
            const saved = localStorage.getItem("wb-autosave");
            if (saved) {
                const strokes: Stroke[] = JSON.parse(saved);
                strokes.forEach(stroke => drawStroke(stroke));
            }
        }
    }, [wbOpen]);

    // Flush any buffered ICE candidates
    async function flushBufferedIce() {
        if (!pcRef.current) return;
        for (const c of bufferedIceRef.current) {
            try { await pcRef.current.addIceCandidate(new RTCIceCandidate(c)); }
            catch (e) { console.warn("Failed adding buffered ICE candidate", e); }
        }
        bufferedIceRef.current = [];
    }


    function pushChat(m: ChatMessage) {
        setChatLog(prev => {
            const updated = [...prev, m];
            setTimeout(() => {
                chatContainerRef.current?.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: "smooth" });
            }, 50);
            return updated;
        });
    }

    async function ensureLocalAV() {
        if (localStreamRef.current) return localStreamRef.current;
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = s;
        if (localVideoRef.current) { localVideoRef.current.srcObject = s; localVideoRef.current.muted = true; }
        return s;
    }

    // Create or reuse peer connection
    async function createPeer(initiator: boolean, otherId: string) {
        if (pcRef.current) {
            console.log("Reusing existing peer connection");
        } else {
            console.log("Creating new peer connection");
            pcRef.current = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        }

        const pc = pcRef.current;

        // Local stream
        const local = await ensureLocalAV();
        local.getTracks().forEach(track => pc.addTrack(track, local));

        // Remote track handling
        pc.ontrack = (e) => {
            if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
        };

        // ICE candidate handling
        pc.onicecandidate = (e) => {
            console.log("ICE candidate generated:", e.candidate);
            if (e.candidate && targetSocketRef.current) {
                socketRef.current?.emit("ice-candidate", { target: targetSocketRef.current, candidate: e.candidate });
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log("ICE state:", pc.iceConnectionState);
        };

        // Flush buffered ICE if any
        flushBufferedIce();

        if (initiator) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socketRef.current?.emit("offer", { target: otherId, sdp: pc.localDescription, caller: socketRef.current.id });
        }

        setJoined(true);
    }

    function join() {
        if (!roomId.trim() || !password.trim()) return alert("room+password required");
        socketRef.current?.emit("join-room", { roomId: roomId.trim(), password: password.trim() });
        setJoined(true);
        ensureLocalAV();
    }

    function toggleAudio() {
        const audioTrack = localStreamRef.current?.getAudioTracks()[0];
        if (!audioTrack) return;
        audioTrack.enabled = !audioTrack.enabled;
        setAudioEnabled(audioTrack.enabled);
    }

    function toggleVideo() {
        const videoTrack = localStreamRef.current?.getVideoTracks()[0];
        if (!videoTrack) return;
        videoTrack.enabled = !videoTrack.enabled;
        setVideoEnabled(videoTrack.enabled);
    }

    async function toggleShare() {
        if (!pcRef.current) return;

        if (sharing) {
            await revertToCam();
            return;
        }

        try {
            const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            screenStreamRef.current = screen;

            const videoTrack = screen.getVideoTracks()[0];
            const audioTrack = screen.getAudioTracks()[0];

            const videoSender = pcRef.current.getSenders().find(s => s.track?.kind === "video");
            if (videoSender && videoTrack) await videoSender.replaceTrack(videoTrack);

            const audioSender = pcRef.current.getSenders().find(s => s.track?.kind === "audio");
            if (audioSender && audioTrack) await audioSender.replaceTrack(audioTrack);

            if (localVideoRef.current) localVideoRef.current.srcObject = screen;

            // Listen for manual stop from Chrome UI
            screenStreamRef.current.getTracks().forEach(track => {
                track.onended = () => revertToCam();
            });

            setSharing(true);
        } catch (err) {
            console.error(err);
            alert("Screen share failed: audio might not be supported on this browser");
        }
    }

    async function revertToCam() {
        if (!pcRef.current) return;

        // Stop screen share tracks if active
        screenStreamRef.current?.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;

        const camStream = await ensureLocalAV();
        const camTrack = camStream.getVideoTracks()[0];
        const audioTrack = camStream.getAudioTracks()[0];

        const videoSender = pcRef.current.getSenders().find(s => s.track?.kind === "video");
        if (videoSender && camTrack) await videoSender.replaceTrack(camTrack);

        const audioSender = pcRef.current.getSenders().find(s => s.track?.kind === "audio");
        if (audioSender && audioTrack) await audioSender.replaceTrack(audioTrack);

        if (localVideoRef.current) localVideoRef.current.srcObject = camStream;

        setSharing(false);
    }

    function sendChat() {
        if (!chatInput.trim()) return;
        const text = chatInput.trim();
        pushChat({ from: "me", text, ts: Date.now() });
        socketRef.current?.emit("chat-message", { roomId, text, ts: Date.now() });
        setChatInput("");
    }

    function startDraw(e: any) {
        drawingRef.current = true;
        strokeRef.current = {
            points: [{ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }],
            color: wbTool === "pen" ? wbColor : "#ffffff",
            size: wbSize
        };
    }
    function moveDraw(e: any) {
        if (!drawingRef.current || !strokeRef.current) return;
        strokeRef.current.points.push({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
        drawStroke(strokeRef.current);
    }
    function endDraw() {
        if (!drawingRef.current || !strokeRef.current) return;
        socketRef.current?.emit("wb-draw", { roomId, stroke: strokeRef.current });
        const saved = localStorage.getItem("wb-autosave");
        const strokes: Stroke[] = saved ? JSON.parse(saved) : [];
        strokes.push(strokeRef.current);
        localStorage.setItem("wb-autosave", JSON.stringify(strokes));
        drawingRef.current = false;
        strokeRef.current = null;
    }

    function drawStroke(stroke: Stroke) {
        const c = canvasRef.current; if (!c) return;
        const ctx = c.getContext("2d")!;
        ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.size;
        ctx.beginPath();
        const pts = stroke.points;
        if (pts.length < 2) return;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
    }

    function clearCanvas() {
        const c = canvasRef.current; if (!c) return;
        c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
        socketRef.current?.emit("wb-clear", { roomId });
        localStorage.removeItem("wb-autosave");
    }

    function formatDate(ts: number) {
        const d = new Date(ts); const now = new Date();
        if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return "Yesterday " + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return d.toDateString() + " " + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function startDragWB(e: React.MouseEvent) { dragRef.current.dragging = true; dragRef.current.offsetX = e.clientX - wbPosition.x; dragRef.current.offsetY = e.clientY - wbPosition.y; window.addEventListener("mousemove", dragWB); window.addEventListener("mouseup", stopDragWB); }
    function dragWB(e: MouseEvent) { if (!dragRef.current.dragging) return; setWbPosition({ x: e.clientX - dragRef.current.offsetX, y: e.clientY - dragRef.current.offsetY }); }
    function stopDragWB() { dragRef.current.dragging = false; window.removeEventListener("mousemove", dragWB); window.removeEventListener("mouseup", stopDragWB); }

    // --- New nuclear hang-up ---
    function hangUp() {
        if (!joined) return;
        socketRef.current?.emit("hang-up", { target: targetSocketRef.current });
        stopEverything();
    }

    function stopEverything() {
        // Stop peer connection
        if (pcRef.current) {
            pcRef.current.getSenders().forEach(s => s.track?.stop());
            pcRef.current.close();
            pcRef.current = null;
        }

        // Stop local camera/audio
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(t => t.stop());
            localStreamRef.current = null;
        }

        // Stop screen share
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(t => t.stop());
            screenStreamRef.current = null;
        }

        // Stop remote video tracks
        if (remoteVideoRef.current?.srcObject) {
            (remoteVideoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
            remoteVideoRef.current.srcObject = null;
        }

        // Reset local video ref
        if (localVideoRef.current) localVideoRef.current.srcObject = null;

        // Reset UI states
        setJoined(false);
        setAudioEnabled(true);
        setVideoEnabled(true);
        setSharing(false);
        bufferedIceRef.current = [];
        targetSocketRef.current = null;
    }

    const TIME_WINDOW = 5 * 60 * 1000; // 5 minutes

    return (
        <div className="flex h-screen bg-gray-900 text-white">
            {!joined && (
                <div className="w-64 bg-gray-800 flex flex-col border-r border-gray-700 p-4 space-y-4">
                    <h2 className="text-xl font-bold text-gray-200">Us</h2>
                    <input value={roomId} onChange={e => setRoomId(e.target.value)} placeholder="Room" className="px-3 py-2 rounded bg-gray-700 text-white" />
                    <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" type="password" className="px-3 py-2 rounded bg-gray-700 text-white" />
                    <button onClick={join} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 transition">Join</button>
                </div>
            )}

            {/* Video */}
            <div className="flex-1 flex flex-col">
                <div className="flex-1 flex justify-center items-center gap-4 p-4">
                    <video ref={localVideoRef} autoPlay muted playsInline className="w-1/2 rounded-lg border border-gray-700 shadow-lg" />
                    <video ref={remoteVideoRef} autoPlay playsInline className="w-1/2 rounded-lg border border-gray-700 shadow-lg" />
                </div>

                {/* Controls */}
                <div className="p-4 flex justify-center gap-4 bg-gray-800 border-t border-gray-700">
                    <button onClick={toggleAudio} className="px-4 py-2 rounded-full bg-gray-700 hover:bg-gray-600 transition">{audioEnabled ? <Mic /> : <MicOff />}</button>
                    <button onClick={toggleVideo} className="px-4 py-2 rounded-full bg-gray-700 hover:bg-gray-600 transition">{videoEnabled ? <Video /> : <VideoOff />}</button>
                    <button onClick={toggleShare} className="px-4 py-2 rounded-full bg-gray-700 hover:bg-gray-600 transition">{sharing ? <ScreenShareOff /> : <ScreenShare />}</button>
                    <button onClick={() => setWbOpen(!wbOpen)} className="px-4 py-2 rounded-full bg-gray-700 hover:bg-gray-600 transition">{wbOpen ? <SquareX /> : <Presentation />}</button>
                    <button onClick={hangUp} className="px-4 py-2 rounded-full bg-red-600 hover:bg-red-500 transition"><ImPhoneHangUp /></button>
                </div>
            </div>

            {/* Chat */}
            <div className="w-80 bg-gray-800 flex flex-col border-l border-gray-700">
                <div className="flex-1 p-4 overflow-y-auto space-y-2" ref={chatContainerRef}>
                    {chatLog.map((msg, idx) => {
                        const prevMsg = chatLog[idx - 1];
                        const showTimestamp = !prevMsg || (msg.ts - prevMsg.ts > TIME_WINDOW);

                        return (
                            <div key={idx} className="flex flex-col">
                                {showTimestamp && (
                                    <div className="text-xs text-gray-400 text-center mb-1">
                                        {formatDate(msg.ts)}
                                    </div>
                                )}
                                <div className={`flex ${msg.from === "me" ? "justify-end" : "justify-start"}`}>
                                    <div className={`px-3 py-2 rounded-lg max-w-[70%] break-words ${msg.from === "me" ? "bg-blue-500 text-white rounded-br-none" : "bg-gray-700 text-gray-100 rounded-bl-none"}`}>
                                        {msg.text}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="p-4 border-t border-gray-700">
                    <input
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") sendChat(); }}
                        placeholder="Type a message"
                        className="w-full px-3 py-2 rounded bg-gray-700 text-white focus:outline-none"
                    />
                </div>
            </div>

            {/* Whiteboard */}
            {wbOpen && (
                <div
                    className="absolute bg-gray-900 shadow-2xl rounded-xl border border-gray-700 flex flex-col"
                    style={{
                        top: wbPosition.y,
                        left: wbPosition.x,
                        width: wbSizeBox.width,
                        height: wbSizeBox.height,
                        zIndex: 50
                    }}
                    tabIndex={0} // make div focusable for key events
                    onKeyDown={(e) => { if (e.key === "Escape") setWbOpen(false); }}
                >
                    {/* Header for drag & close */}
                    <div
                        className="flex justify-between items-center bg-gray-800 px-3 py-2 cursor-move rounded-t-xl select-none"
                        onMouseDown={startDragWB}
                    >
                        <span className="font-bold text-gray-200">Whiteboard</span>

                        <button
                            onClick={clearCanvas}
                            className="text-gray-300 hover:text-white transition"
                        >
                            Clear
                        </button>

                        {/* Slightly bigger close button */}
                        <button
                            onClick={() => setWbOpen(false)}
                            className="text-red-500 hover:text-red-400 transition font-bold text-2xl"
                        >
                            ×
                        </button>
                    </div>

                    {/* Canvas */}
                    <canvas
                        ref={canvasRef}
                        width={wbSizeBox.width}
                        height={wbSizeBox.height - 40}
                        className="flex-1 bg-gray-900 rounded-b-xl"
                        onMouseDown={startDraw}
                        onMouseMove={moveDraw}
                        onMouseUp={endDraw}
                        onMouseLeave={endDraw}
                    />
                </div>
            )}

        </div>
    );
}
