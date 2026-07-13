import React from 'react';
import {
    AbsoluteFill,
    interpolate,
    spring,
    useCurrentFrame,
    useVideoConfig
} from 'remotion';

export const AudnixVideo: React.FC = () => {
    const frame = useCurrentFrame();
    const { fps, durationInFrames, width, height } = useVideoConfig();

    const opacity = interpolate(
        frame,
        [0, 30, durationInFrames - 30, durationInFrames],
        [0, 1, 1, 0]
    );

    const scale = spring({
        frame,
        fps,
        config: {
            damping: 12,
        },
    });

    return (
        <AbsoluteFill
            style={{
                backgroundColor: 'black',
                justifyContent: 'center',
                alignItems: 'center',
                color: 'white',
                fontFamily: 'Inter, sans-serif',
            }}
        >
            <div
                style={{
                    opacity,
                    transform: `scale(${scale})`,
                    textAlign: 'center',
                }}
            >
                <h1
                    style={{
                        fontSize: '120px',
                        fontWeight: 900,
                        letterSpacing: '-0.05em',
                        textTransform: 'uppercase',
                        margin: 0,
                    }}
                >
                    Audnix<span style={{ color: '#00d2ff' }}>.AI</span>
                </h1>
                <p
                    style={{
                        fontSize: '40px',
                        fontWeight: 700,
                        letterSpacing: '0.2em',
                        textTransform: 'uppercase',
                        color: 'rgba(255, 255, 255, 0.4)',
                        marginTop: '20px',
                    }}
                >
                    Intelligent Revenue Architecture
                </p>
            </div>

            {/* Background Glow */}
            <div
                style={{
                    position: 'absolute',
                    width: '800px',
                    height: '800px',
                    background: 'radial-gradient(circle, rgba(0, 210, 255, 0.15) 0%, transparent 70%)',
                    borderRadius: '50%',
                    filter: 'blur(100px)',
                    zIndex: -1,
                }}
            />
        </AbsoluteFill>
    );
};
