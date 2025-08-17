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

const SIGNALING_SERVER = "http://localhost:5000";
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

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

    socket.on("other-user", (id: string) => { targetSocketRef.current = id; createPeer(true, id); });
    socket.on("offer", async (p: any) => {
      targetSocketRef.current = p.caller;
      if (!pcRef.current) await createPeer(false, p.caller);
      await pcRef.current!.setRemoteDescription(new RTCSessionDescription(p.sdp));
      const ans = await pcRef.current!.createAnswer();
      await pcRef.current!.setLocalDescription(ans);
      socket.emit("answer", { target: p.caller, sdp: pcRef.current!.localDescription });
    });
    socket.on("answer", async (p: any) => { if (p.sdp && pcRef.current) await pcRef.current.setRemoteDescription(new RTCSessionDescription(p.sdp)); });
    socket.on("ice-candidate", async (p: any) => {
      if (!p.candidate) return;
      if (pcRef.current) await pcRef.current.addIceCandidate(new RTCIceCandidate(p.candidate));
      else bufferedIceRef.current.push(p.candidate);
    });

    socket.on("chat-message", ({ text, ts }) => pushChat({ from: "peer", text, ts: ts || Date.now() }));
    socket.on("wb-draw", ({ stroke }) => drawStroke(stroke as Stroke));
    socket.on("wb-clear", () => clearCanvas());

    // Peer side: only remove remote stream, keep own AV running
socket.on("peer-hang-up", () => {
  // Remove only remote video from peer
  if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

  // Close peer connection if it exists
  if (pcRef.current) {
    pcRef.current.getSenders().forEach(s => {
      if (s.track && s.track !== localStreamRef.current?.getAudioTracks()[0] &&
          s.track !== localStreamRef.current?.getVideoTracks()[0]) {
        s.track.stop();
      }
    });
    pcRef.current.close();
    pcRef.current = null;
    targetSocketRef.current = null;
  }

  // Keep peer’s own local stream running
  setSharing(false);
  // Do NOT change setJoined; sidebar state stays as it is
});



    const saved = localStorage.getItem("wb-autosave");
    if (saved) {
      const strokes: Stroke[] = JSON.parse(saved);
      strokes.forEach(drawStroke);
    }

    return () => socket.disconnect();
  }, []);

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

  async function createPeer(initiator: boolean, otherId: string) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    const local = await ensureLocalAV();
    local.getTracks().forEach(t => pc.addTrack(t, local));

    pc.ontrack = (e) => { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0]; };
    pc.onicecandidate = (e) => { if (e.candidate && targetSocketRef.current) socketRef.current?.emit("ice-candidate", { target: targetSocketRef.current, candidate: e.candidate }); };

    for (const c of bufferedIceRef.current) await pc.addIceCandidate(new RTCIceCandidate(c));
    bufferedIceRef.current = [];

    if (initiator) {
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
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
    if (sharing) { await revertToCam(); setSharing(false); return; }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: true }
      });

      screenStreamRef.current = screen;
      const screenTrack = screen.getVideoTracks()[0];

      const sender = pcRef.current.getSenders().find(s => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(screenTrack);

      const audioTrack = screen.getAudioTracks()[0];
      if (audioTrack) {
        const audioSender = pcRef.current.getSenders().find(s => s.track?.kind === "audio");
        if (audioSender) await audioSender.replaceTrack(audioTrack);
      }

      if (localVideoRef.current) localVideoRef.current.srcObject = screen;

      screenTrack.onended = async () => { await revertToCam(); setSharing(false); };
      setSharing(true);

    } catch (err) {
      console.error(err);
      alert("Screen share failed: audio might not be supported on this browser");
    }
  }

  async function revertToCam() {
    if (!pcRef.current) return;
    const camStream = await ensureLocalAV();
    const camTrack = camStream.getVideoTracks()[0];
    const sender = pcRef.current.getSenders().find(s => s.track?.kind === "video");
    if (sender) await sender.replaceTrack(camTrack);
    if (localVideoRef.current) localVideoRef.current.srcObject = camStream;
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

  function startResizeWB(e: React.MouseEvent) { resizeRef.current.resizing = true; resizeRef.current.startX = e.clientX; resizeRef.current.startY = e.clientY; resizeRef.current.startW = wbSizeBox.width; resizeRef.current.startH = wbSizeBox.height; window.addEventListener("mousemove", resizeWB); window.addEventListener("mouseup", stopResizeWB); e.stopPropagation(); }
  function resizeWB(e: MouseEvent) { if (!resizeRef.current.resizing) return; const newW = resizeRef.current.startW + (e.clientX - resizeRef.current.startX); const newH = resizeRef.current.startH + (e.clientY - resizeRef.current.startY); setWbSizeBox({ width: Math.max(300, newW), height: Math.max(200, newH) }); }
  function stopResizeWB() { resizeRef.current.resizing = false; window.removeEventListener("mousemove", resizeWB); window.removeEventListener("mouseup", stopResizeWB); }

  function hangUp() {
  socketRef.current?.emit("hang-up");

  // Stop/close peer connection if it exists
  if (pcRef.current) {
    pcRef.current.getSenders().forEach(s => { 
      if (s.track && s.track !== localStreamRef.current?.getAudioTracks()[0] && s.track !== localStreamRef.current?.getVideoTracks()[0]) {
        s.track.stop();
      }
    });
    pcRef.current.close();
    pcRef.current = null;
    targetSocketRef.current = null;
  }

  // Stop any screen share tracks
  screenStreamRef.current?.getTracks().forEach(t => t.stop());
  screenStreamRef.current = null;

  // Restore own camera/audio
  if (localVideoRef.current && localStreamRef.current) {
    localVideoRef.current.srcObject = localStreamRef.current;
  }

  // Clear remote video
  if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

  // Reset UI states for sidebar and buttons
  setJoined(false);      // sidebar will appear correctly
  setAudioEnabled(true);
  setVideoEnabled(true);
  setSharing(false);
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

            {/* Resize handle */}
            <div
            className="absolute w-5 h-5 bg-blue-500 bottom-2 right-2 cursor-se-resize rounded-full shadow-lg hover:bg-blue-400 transition"
            onMouseDown={startResizeWB}
            />
        </div>
        )}

    </div>
  );
}
