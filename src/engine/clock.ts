/**
 * In-game time.
 *
 * Port of `Assets/Scripts/Spymaster/Core/Time/SpymasterClock.cs`, minus the blockage registry: with
 * missions resolving on deploy there is nothing running that a decision could interrupt yet.
 *
 * Minutes, hours and days are **absolute and never wrap**, because timers are scheduled against a
 * running total rather than a time of day. The minute is the finest tick anything schedules
 * against, so a Feed can release faster than once an hour.
 */

export const SECONDS_IN_MINUTE = 60;
export const MINUTES_IN_HOUR = 60;

export interface ClockListeners {
    onMinuteChanged?: (totalMinutes: number) => void;
    onHourChanged?: (totalHours: number) => void;
    onDayChanged?: (totalDays: number) => void;
}

export interface ClockOptions {
    /** Real seconds to in-game seconds at normal speed. 60 means one real second is one in-game minute. */
    timeScale?: number;
    hoursPerDay?: number;
    /** Minute the run starts at, so a loaded state resumes where it left off. */
    startMinute?: number;
}

export class Clock {
    private elapsedSeconds = 0;
    private totalMinutesValue = 0;
    private totalHoursValue = 0;
    private totalDaysValue = 0;

    private readonly hoursPerDay: number;

    /** Base rate from GlobalConfig.timeScale. */
    timeScale: number;
    /** The x1 / x3 / x8 selector, applied on top of the base rate. 0 is the same as paused. */
    speedMultiplier = 1;
    isPaused = false;

    constructor(
        options: ClockOptions = {},
        private readonly listeners: ClockListeners = {},
    ) {
        this.timeScale = options.timeScale ?? 60;
        this.hoursPerDay = options.hoursPerDay ?? 24;

        const startMinute = options.startMinute ?? 0;
        this.elapsedSeconds = startMinute * SECONDS_IN_MINUTE;
        this.totalMinutesValue = startMinute;
        this.totalHoursValue = Math.floor(startMinute / MINUTES_IN_HOUR);
        this.totalDaysValue = this.hoursPerDay > 0 ? Math.floor(this.totalHoursValue / this.hoursPerDay) : 0;
    }

    get totalMinutes(): number {
        return this.totalMinutesValue;
    }

    get totalHours(): number {
        return this.totalHoursValue;
    }

    get totalDays(): number {
        return this.totalDaysValue;
    }

    get hourOfDay(): number {
        return this.hoursPerDay > 0 ? this.totalHoursValue % this.hoursPerDay : this.totalHoursValue;
    }

    get minuteOfHour(): number {
        return this.totalMinutesValue % MINUTES_IN_HOUR;
    }

    /** `HH:MM`, for the clock readout. */
    get timeOfDay(): string {
        const hour = String(this.hourOfDay).padStart(2, '0');
        const minute = String(this.minuteOfHour).padStart(2, '0');
        return `${hour}:${minute}`;
    }

    /** Feeds real elapsed time in. Does nothing while paused or at speed zero. */
    tick(realDeltaSeconds: number): void {
        if (this.isPaused || this.speedMultiplier <= 0) return;
        this.advance(realDeltaSeconds * this.timeScale * this.speedMultiplier);
    }

    /** Jumps forward without waiting. Used by the skip control and by tests. */
    addMinutes(minutes: number): void {
        this.advance(minutes * SECONDS_IN_MINUTE);
    }

    /**
     * Walks every crossed minute rather than jumping to the end, so nothing scheduled against a
     * minute in between is skipped when a slow frame or a fast speed setting covers several at once.
     */
    private advance(scaledDeltaSeconds: number): void {
        if (scaledDeltaSeconds <= 0) return;

        this.elapsedSeconds += scaledDeltaSeconds;
        const newTotalMinutes = Math.floor(this.elapsedSeconds / SECONDS_IN_MINUTE);

        for (let minute = this.totalMinutesValue + 1; minute <= newTotalMinutes; minute++) {
            this.totalMinutesValue = minute;
            this.listeners.onMinuteChanged?.(minute);

            if (minute % MINUTES_IN_HOUR !== 0) continue;
            this.totalHoursValue = minute / MINUTES_IN_HOUR;
            this.listeners.onHourChanged?.(this.totalHoursValue);

            if (this.hoursPerDay <= 0 || this.totalHoursValue % this.hoursPerDay !== 0) continue;
            this.totalDaysValue = this.totalHoursValue / this.hoursPerDay;
            this.listeners.onDayChanged?.(this.totalDaysValue);
        }
    }
}

/** The speed rail from the UI catalogue: x0 is pause, the rest scale the base rate. */
export const SPEED_STEPS = [0, 1, 3, 8] as const;
