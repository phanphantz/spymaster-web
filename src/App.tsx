import { useEffect, type ReactNode } from 'react';
import './ui/app.css';
import { useGame } from './store/gameStore';
import { DataPanel } from './ui/dev/DataPanel';
import { EmploymentScreen } from './ui/screens/EmploymentScreen';
import { MissionResult } from './ui/screens/MissionResult';
import { MissionSummary } from './ui/screens/MissionSummary';
import { TopBar, WorldMapScreen } from './ui/screens/WorldMapScreen';

export function App(): ReactNode {
    const phase = useGame((state) => state.phase);
    const overlay = useGame((state) => state.overlay);
    const error = useGame((state) => state.error);
    const init = useGame((state) => state.init);

    useEffect(() => {
        void init();
    }, [init]);

    useGameClock(phase === 'playing');

    if (phase === 'loading') {
        return (
            <div className="centre-stage">
                <p className="title">Loading…</p>
            </div>
        );
    }

    if (phase === 'failed') {
        return (
            <div className="centre-stage">
                <div>
                    <p className="title danger">Could not start</p>
                    <p className="meta">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="app">
            {phase === 'employment' ? (
                <EmploymentScreen />
            ) : (
                <>
                    <TopBar />
                    <WorldMapScreen />
                </>
            )}

            {overlay === 'missionSummary' || overlay === 'shop' ? <MissionSummary /> : null}
            {overlay === 'result' ? <MissionResult /> : null}

            {import.meta.env.DEV ? <DataPanel /> : null}
        </div>
    );
}

/**
 * Drives the clock off animation frames.
 *
 * Time is fed in as real elapsed seconds rather than a fixed step, and a long gap is capped: a
 * backgrounded tab would otherwise come back with several in-game hours of missions arriving at
 * once, which reads as a bug rather than as time passing.
 */
function useGameClock(running: boolean): void {
    const tick = useGame((state) => state.tick);

    useEffect(() => {
        if (!running) return;

        let frame = 0;
        let last = performance.now();

        const step = (now: number) => {
            const delta = Math.min((now - last) / 1000, 0.25);
            last = now;
            tick(delta);
            frame = requestAnimationFrame(step);
        };

        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
    }, [running, tick]);
}
