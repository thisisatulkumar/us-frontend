'use client';

import { useState, useEffect, useRef } from 'react';

import { io, Socket } from 'socket.io-client';

import {
    Mic,
    MicOff,
    Video,
    VideoOff,
    LayoutGrid,
    MessageSquare,
    Presentation
} from 'lucide-react';
import { ImPhoneHangUp } from "react-icons/im";

const SIGNALING_SERVER = 'http://localhost:5000';
const STUN_SERVERS = [
    {
        urls: 'stun:stun.l.google.com:19302'
    }
];

const displayTime = () => {
    const date = new Date();

    const hours = date.getHours();
    let minutes:string | number = date.getMinutes();

    if (minutes < 10) {
        minutes = `0${minutes}`;
    }

    if (hours > 12) {
        return `${hours - 12}:${minutes} PM`;
    }
    return `${hours}:${minutes} AM`;
}

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
                localVideoRef.current.muted = false;
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
        <div className="h-screen flex flex-col bg-[#181A1B]">

            {/* Body */}
            <div className="h-[90vh] flex justify-center items-center w-screen p-5">
                <div className="w-[50%] p-2.5 h-full">
                    <h1 className="text-[#E2DFDB]">Local</h1>
                    <video 
                        className="rounded-md w-full h-full bg-black"
                        ref={localVideoRef} 
                        autoPlay 
                        playsInline 
                        muted 
                    />
                </div>
                
                <div className="w-[50%] p-2.5 h-full">
                    <h1 className="text-[#E2DFDB]">Remote</h1>
                    <video 
                        className="rounded-md w-full h-full bg-black"
                        ref={remoteVideoRef} 
                        autoPlay 
                        playsInline 
                        muted 
                    />
                </div>
            </div>
            
            {/* Footer */}
            <div className="flex justify-center items-center h-[10vh] px-5">

                {/* Info */}
                <div className="info w-[25%] pl-3.5 text-gray-100">
                    <span className="font-semibold">Joined at: </span>
                    <span>{displayTime()}</span>
                </div>

                {/* Control Buttons */}
                <div className="controls w-[50%] flex items-center justify-around">
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
                        className="bg-[#464D5A] hover:bg-[#6A7282] h-[5vh] w-[8vh] flex justify-center items-center rounded-md cursor-pointer transition-all duration-300 text-[#E2DFDB]"
                    >
                        {
                            audioEnabled ? <Mic /> : <MicOff />
                        }
                    </button>

                    <button
                        onClick={showHideVideo}
                        className="bg-[#464D5A] hover:bg-[#6A7282] h-[5vh] w-[8vh] flex justify-center items-center rounded-md cursor-pointer transition-all duration-300 text-[#E2DFDB]"
                    >
                        {
                            videoEnabled ? <Video /> : <VideoOff />
                        }
                    </button>

                    <button
                        onClick={hangUpCall}
                        className="bg-[#900003] hover:bg-[#E7000B] h-[5vh] w-[8vh] flex justify-center items-center rounded-md cursor-pointer transition-all duration-300  text-[#E2DFDB]"
                    >
                        <ImPhoneHangUp />
                    </button>
                </div>
                
                {/* Utility Buttons */}
                <div className="w-[25%] flex justify-end items-center pr-3.5 text-[#E2DFDB]">
                    <LayoutGrid className="mx-5" />
                    <Presentation className="mx-5" />
                    <MessageSquare className="mx-5" />
                </div>
            </div>
        </div>
    );
}
