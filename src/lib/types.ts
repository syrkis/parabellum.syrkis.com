// Basic game types
export type UnitType = "unit" | "building" | "resource";
export type CellType = "grass" | "water" | "empty";

// Game entities
export interface Unit {
    id: number;
    x: number;
    y: number;
    size: number;
    health: number;
    // type: UnitType;
}

// Game state structures
export interface Scene {
    terrain: number[][];
    cfg?: Cfg;
}

export interface Cfg {
    place: string;
    size: number;
    teams: number[];
}

export interface State {
    step: number;
    unit: Unit[];
}

// API-related types
export interface RawInfo {
    terrain: number[][];
    [key: string]: unknown;
}

export interface RawState {
    unit_positions: number[]; // Raw unit position data from API
    step: number;
    [key: string]: unknown;
}

export interface ApiResponse<T> {
    state?: RawState;
    [key: string]: unknown;
}

export interface LogEntry {
    time: string;
    message: string;
}

export interface ChatEntry {
    text: string;
    user: "person" | "system";
}

export interface Marks {
    king: [number, number];
    queen: [number, number];
    rook: [number, number];
    bishop: [number, number];
    knight: [number, number];
    pawn: [number, number];
}
