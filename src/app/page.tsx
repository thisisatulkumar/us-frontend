'use client';

import { useState, useEffect, useRef } from 'react';

import { io, Socket } from 'socket.io-client';

const SIGNALING_SERVER = 'http://localhost:5000';
const STUN_SERVERS = [
    {
        urls: 'stun:stun.l.google.com:19302'
    }
];

export default function Home() {
    const [roomId, setRoomId] = useState<string>('');
    const [joined, setJoined] = useState<boolean>(false);
    const [status, setStatus] = useState<string>('idle');
    const [audioEnabled, setAudioEnabled] = useState<boolean>(true);
    const [videoEnabled, setVideoEnabled] = useState<boolean>(true);
    
    const socketRef = useRef<Socket | null>(null);
    const targetSocketRef = useRef<string | null>(null);
    const bufferedIceRef = useRef<RTCIceCandidateInit[]>([]);

    const pcRef = useRef<RTCPeerConnection | null>(null);

    const localStreamRef = useRef<MediaStream | null>(null);
    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        socketRef.current = io(SIGNALING_SERVER);
        const socket = socketRef.current;

        socket.on('connect', () => {
            console.log('Connected to the signaling server', socket.id);
        });

        socket.on('other-user', otherSocketId => {
            console.log('Other user in the house: ', otherSocketId)

            targetSocketRef.current = otherSocketId;

            createPeer(true, otherSocketId);
        });

        socket.on('offer', async payload => {
            if (!payload.caller || !payload.sdp) return;

            targetSocketRef.current = payload.caller;

            if (!pcRef.current) {
                await createPeer(false, payload.caller);
            }

            await pcRef.current!.setRemoteDescription(new RTCSessionDescription(payload.sdp));

            const answer = await pcRef.current!.createAnswer();
            await pcRef.current!.setLocalDescription(answer);

            socket.emit('answer', {
                target: payload.caller,
                sdp: pcRef.current!.localDescription
            });
        });

        socket.on('answer', async payload => {
            if (!payload.sdp) return;
            if (!pcRef.current) return;

            await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        });

        socket.on('ice-candidate', async payload => {
            if (!payload.candidate) return;
            if (pcRef.current) {
                await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
            } else {
                bufferedIceRef.current.push(payload.candidate);
            }
        });

        return () => {
            socket.disconnect();
        };
    }, []);
    
    // Get local camera + mic stream
    const ensureLocalStream = async () => {
        if (localStreamRef.current) return localStreamRef.current;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: true
            });

            localStreamRef.current = stream;

            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
                localVideoRef.current.muted = true;
            }

            return stream;
        } catch (err) {
            console.log("getUserMedia error: ", err);
            alert('Access diyo bhaiya');

            throw err;
        }
    }  

    const muteUnmuteAudio = () => {
        if (!localStreamRef.current) return;

        const audioTrack = localStreamRef.current.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;

            setAudioEnabled(audioTrack.enabled);
        }
    }

    const showHideVideo = () => {
        if (!localStreamRef.current) return;

        const videoTrack = localStreamRef.current.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            
            setVideoEnabled(videoTrack.enabled);
        }
    }

    const hangUpCall = () => {
        if (pcRef.current){
            pcRef.current.close();
            pcRef.current = null;
        }

        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
        }

        if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
        }

        if (localVideoRef.current) {
            localVideoRef.current.srcObject = null;
        }

        setJoined(false);
        setStatus('call ended');
        setVideoEnabled(false);
        setAudioEnabled(false);

        targetSocketRef.current = null;
    }

    const createPeer = async (isInitiator: boolean, otherSocketId: string) => {
        setStatus('creating-peer');

        const pc = new RTCPeerConnection({
            iceServers: STUN_SERVERS
        });
        pcRef.current = pc;

        const localStream = await ensureLocalStream();
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

        pc.ontrack = event => {
            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = event.streams[0];
            }
        }

        pc.onicecandidate = event => {
            if (event.candidate && targetSocketRef.current) {
                socketRef.current?.emit('ice-candidate', {
                    target: targetSocketRef.current,
                    candidate: event.candidate
                });
            }
        }

        for (const c of bufferedIceRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(c));
        }
        bufferedIceRef.current = [];

        if (isInitiator) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            socketRef.current?.emit('offer', {
                target: otherSocketId,
                sdp: pc.localDescription
            });
        }

        setStatus('peer-created');
        setJoined(true);
    }

    const joinRoom = () => {
        if (!roomId.trim()) {
            alert("Boka ho ka be bilkul");
            return;
        }

        if (pcRef.current) {
            pcRef.current.close();
            pcRef.current = null;
        }

        socketRef.current?.emit('join-room', {
            roomId: roomId.trim()
        });
        setStatus('joined');
    }

    useEffect(() => {
        return () => {
            if (pcRef.current) pcRef.current.close();

            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());

                socketRef.current?.disconnect();
            }
        }
    }, []);

    return (
        <div style={{ padding: 12, fontFamily: "Arial, sans-serif" }}>
            <div style={{ display: "flex", gap: 16 }}>
                <div>
                    <input 
                        value={roomId}
                        onChange={event => setRoomId(event.target.value)}
                        placeholder="Room ID daal"
                        style={{ padding: 6 }}
                    />

                    <button 
                        onClick={joinRoom}
                        disabled={joined}
                        style={{ marginLeft: 6, padding: 6 }}
                    >
                        Join / Create
                    </button>

                    <button
                        onClick={muteUnmuteAudio}
                    >
                        Mute
                    </button>

                    <button
                        onClick={showHideVideo}
                    >
                        Show/Hide 
                    </button>

                    <button
                        onClick={hangUpCall}
                    >
                        Hang Up
                    </button>
                </div>

                <div>
                    <h1>Local</h1>
                    <video 
                        ref={localVideoRef} 
                        autoPlay 
                        playsInline 
                        muted 
                        style={{ width: 300, background: "#000" }} 
                    />

                    <h1>Remote</h1>
                    <video 
                        ref={remoteVideoRef} 
                        autoPlay 
                        playsInline 
                        muted 
                        style={{ width: 300, background: "#000" }} 
                    />
                </div>
            </div>
        </div>
    );
}
