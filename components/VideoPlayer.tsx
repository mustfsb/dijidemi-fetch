'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, RotateCcw, RotateCw, Maximize, Minimize } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import Hls from 'hls.js';

interface VideoPlayerProps {
    src: string;
    videoId: string | number; // Unique ID to save progress
    autoPlay?: boolean;
}

export default function VideoPlayer({ src, videoId, autoPlay = false }: VideoPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [showControls, setShowControls] = useState(true);
    const [isFullScreen, setIsFullScreen] = useState(false);

    // Persistence key
    const storageKey = `video-progress-${videoId}`;

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        let hls: Hls | null = null;

        const loadVideo = () => {
            // Handle HLS
            if (Hls.isSupported() && src.endsWith('.m3u8')) {
                hls = new Hls();
                hls.loadSource(src);
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    video.play().catch(() => { }); // Attempt autoplay if requested/allowed, but usually waits for user
                    if (!autoPlay) video.pause();
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                // For Safari
                video.src = src;
            } else {
                // For standard MP4
                video.src = src;
            }
        };

        loadVideo();

        // Load saved progress
        const savedTime = localStorage.getItem(storageKey);
        if (savedTime) {
            video.currentTime = parseFloat(savedTime);
        }

        const handleTimeUpdate = () => {
            if (!isNaN(video.currentTime)) {
                setProgress(video.currentTime);
                localStorage.setItem(storageKey, video.currentTime.toString());
            }
        };

        const handleLoadedMetadata = () => {
            if (!isNaN(video.duration)) {
                setDuration(video.duration);
            }
            if (autoPlay && isPlaying) video.play().catch(() => { });
        };

        const handleEnded = () => {
            setIsPlaying(false);
        };

        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);

        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('ended', handleEnded);
        video.addEventListener('play', handlePlay);
        video.addEventListener('pause', handlePause);

        return () => {
            if (hls) {
                hls.destroy();
            }
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            video.removeEventListener('ended', handleEnded);
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('pause', handlePause);
        };
    }, [videoId, src, autoPlay, storageKey]);

    const togglePlay = () => {
        if (!videoRef.current) return;
        if (videoRef.current.paused) {
            videoRef.current.play();
        } else {
            videoRef.current.pause();
        }
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!videoRef.current) return;
        const time = parseFloat(e.target.value);
        if (isFinite(time)) {
            videoRef.current.currentTime = time;
            setProgress(time);
        }
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!videoRef.current) return;
        const newVol = parseFloat(e.target.value);
        videoRef.current.volume = newVol;
        setVolume(newVol);
        setIsMuted(newVol === 0);
    };

    const toggleMute = () => {
        if (!videoRef.current) return;
        if (isMuted) {
            videoRef.current.volume = volume || 1;
            setIsMuted(false);
        } else {
            videoRef.current.volume = 0;
            setIsMuted(true);
        }
    };

    const changeSpeed = (rate: number) => {
        if (!videoRef.current) return;
        videoRef.current.playbackRate = rate;
        setPlaybackRate(rate);
    };

    const skip = (seconds: number) => {
        if (!videoRef.current) return;
        videoRef.current.currentTime += seconds;
    };

    const formatTime = (time: number) => {
        if (isNaN(time)) return '0:00';
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    };

    const toggleFullScreen = () => {
        if (!document.fullscreenElement) {
            containerRef.current?.requestFullscreen();
            setIsFullScreen(true);
        } else {
            document.exitFullscreen();
            setIsFullScreen(false);
        }
    };

    useEffect(() => {
        const handleFullScreenChange = () => {
            setIsFullScreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullScreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullScreenChange);
    }, []);

    return (
        <div
            ref={containerRef}
            className="relative group rounded-lg overflow-hidden bg-black aspect-video shadow-xl"
            onMouseEnter={() => setShowControls(true)}
            onMouseLeave={() => setShowControls(false)}
        >
            <video
                ref={videoRef}
                className="w-full h-full object-contain"
                onClick={togglePlay}
                playsInline
            />

            {/* Controls Overlay */}
            <div className={cn(
                "absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 transition-opacity duration-300",
                showControls ? "opacity-100" : "opacity-0"
            )}>
                {/* Progress Bar */}
                <div className="mb-4 flex items-center gap-2 text-white text-xs">
                    <span className="min-w-[40px] text-right">{formatTime(progress)}</span>
                    <input
                        type="range"
                        min={0}
                        max={duration || 100}
                        step={0.1}
                        value={progress}
                        onChange={handleSeek}
                        className="flex-1 cursor-pointer accent-white h-1 bg-white/30 rounded-lg appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full text-white"
                    />
                    <span className="min-w-[40px]">{formatTime(duration)}</span>
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" onClick={togglePlay}>
                            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                        </Button>

                        <div className="flex items-center gap-1 group/vol">
                            <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" onClick={toggleMute}>
                                {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                            </Button>
                            <div className="w-0 overflow-hidden group-hover/vol:w-20 transition-all duration-300 flex items-center">
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.1}
                                    value={isMuted ? 0 : volume}
                                    onChange={handleVolumeChange}
                                    className="w-20 cursor-pointer accent-white h-1 bg-white/30 rounded-lg appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Skip Buttons */}
                        <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" onClick={() => skip(-10)}>
                            <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" onClick={() => skip(10)}>
                            <RotateCw className="h-4 w-4" />
                        </Button>

                        <div className="relative group/speed">
                            <select
                                value={playbackRate}
                                onChange={(e) => changeSpeed(parseFloat(e.target.value))}
                                className="bg-black/50 text-white border border-white/20 rounded px-1 py-1 text-xs focus:outline-none appearance-none cursor-pointer hover:bg-white/20 w-[40px] text-center"
                            >
                                <option value="0.5">0.5x</option>
                                <option value="0.75">0.75x</option>
                                <option value="1">1x</option>
                                <option value="1.25">1.25x</option>
                                <option value="1.5">1.5x</option>
                                <option value="2">2x</option>
                            </select>
                            {/* Hide arrow but keep functionality via appearance-none. 
                                Or we could overlay a styled div. For now, simple text-center works with specific width. 
                             */}
                        </div>

                        <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" onClick={toggleFullScreen}>
                            {isFullScreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Center Play Button */}
            {!isPlaying && (
                <div
                    className="absolute inset-0 flex items-center justify-center cursor-pointer bg-black/30"
                    onClick={togglePlay}
                >
                    <div className="bg-white/20 backdrop-blur-sm p-4 rounded-full hover:scale-110 transition-transform">
                        <Play className="h-8 w-8 text-white fill-white" />
                    </div>
                </div>
            )}
        </div>
    );
}
