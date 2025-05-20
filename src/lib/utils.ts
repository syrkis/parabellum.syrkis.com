import type { CellType, Unit, RawState, State, Marks, ChatEntry, LogEntry } from "./types";
import * as d3 from "d3";

export const API_BASE_URL = "http://localhost:8000";

/**
 * Constants
 */
export const DRAG_THRESHOLD = 200; // ms to distinguish between click and drag

/**
 * Chess symbols and mark order
 */
export const chessSymbols: Record<string, string> = {
    "king": "♔", 
    "queen": "♕", 
    "bishop": "♗", 
    "knight": "♘", 
    "rook": "♖", 
    "pawn": "♙"
};

export const markOrder = ["king", "queen", "bishop", "knight", "rook", "pawn"].sort();

/**
 * Creates a complete API URL by combining the base URL with an endpoint
 * @param endpoint The API endpoint path
 */
export function getApiUrl(endpoint: string): string {
    return `${API_BASE_URL}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
}

/**
 * Makes an API request and returns the response data
 * @param endpoint The API endpoint path (without base URL)
 * @param method The HTTP method to use
 * @param body Optional request body (will be JSON stringified)
 * @returns The parsed JSON response
 */
export async function apiRequest<T>(
    endpoint: string,
    method = "GET",
    body?: Record<string, unknown>,
): Promise<T> {
    const url = getApiUrl(endpoint);
    const options: RequestInit = { method };

    if (body) {
        options.headers = {
            "Content-Type": "application/json",
        };
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
        throw new Error(
            `API error (${response.status}): ${response.statusText}`,
        );
    }

    const result = await response.json();

    // Check for application-level errors
    if (
        result &&
        typeof result === "object" &&
        "error" in result &&
        result.error
    ) {
        throw new Error(`API error: ${result.error}`);
    }

    return result;
}

/**
 * Command related utilities
 */

// Command map for aliases/shortcuts (first letter shortcuts)
const commandAliases = {
    i: "init",
    r: "reset",
    s: "step",
    c: "close",
    h: "help",
    p: "play",
};

// Resolve command alias to full command
export function resolveCommand(cmd: string): string {
    // If it's a single character and we have an alias for it
    if (cmd.length === 1 && cmd in commandAliases) {
        return commandAliases[cmd as keyof typeof commandAliases];
    }
    return cmd;
}

/**
 * Process a single command
 * @param command The command text including the leading |
 * @param handlers An object with command handler functions
 * @param addLog Function to add log entries
 */
export async function processCommand(
    command: string, 
    handlers: {
        initGame: () => Promise<void>;
        resetGame: () => Promise<void>;
        stepGame: () => Promise<void>;
        closeGame: () => Promise<void>;
        toggleGameLoop: () => void;
    },
    addLog: (message: string) => void
): Promise<void> {
    // Remove the leading | and trim whitespace
    const cmdRaw = command.substring(1).trim().toLowerCase();

    // Resolve any command aliases
    const cmd = resolveCommand(cmdRaw);

    switch (cmd) {
        case "init":
            await handlers.initGame();
            // Log to logs but don't add to messages
            addLog("Game initialized");
            break;
        case "reset":
            await handlers.resetGame();
            addLog("Game reset");
            break;
        case "step":
            await handlers.stepGame();
            addLog("Game stepped");
            break;
        case "close":
            await handlers.closeGame();
            addLog("Game closed");
            break;
        case "play":
            handlers.toggleGameLoop();
            break;
        case "help":
            addLog(
                "Available commands:\n" +
                    "| init (i) - Initialize new game\n" +
                    "| reset (r) - Reset current game\n" +
                    "| step (s) - Advance game state\n" +
                    "| play (p) - Start/pause automatic stepping (every 500ms)\n" +
                    "| close (c) - Close current game\n" +
                    "| help (h) - Show available commands\n\n" +
                    "You can use the first letter as shortcut (| i, | r, | s, | p, | c, | h)\n" +
                    "Press Enter without command to run step\n" +
                    "Chain commands with multiple bars (| i | r | s)",
            );
            break;
        default:
            // Log unknown command to logs, not messages
            addLog(
                `Unknown command: '${cmdRaw}'. Type '| help' for available commands.`,
            );
    }
}

/**
 * Process multiple commands (for chaining)
 * @param commandText Text containing one or more piped commands
 * @param handlers Command handler functions
 * @param addLog Function to add log entries
 */
export async function processCommands(
    commandText: string,
    handlers: Parameters<typeof processCommand>[1],
    addLog: (message: string) => void
): Promise<void> {
    // Split by | and filter out empty segments
    const commands = commandText
        .split("|")
        .map((cmd) => cmd.trim())
        .filter((cmd) => cmd.length > 0)
        .map((cmd) => `|${cmd}`); // Add back the | prefix for processing

    // Process each command sequentially
    for (const cmd of commands) {
        await processCommand(cmd, handlers, addLog);
    }
}

/**
 * Mark utility functions
 */

// Return list of active marks (those that are placed on the board)
export function getActiveMarks(marks: Marks): string[] {
    return Object.entries(marks)
        .filter(([_, coords]) => coords[0] !== 0 && coords[1] !== 0)
        .map(([piece, _]) => piece);
}

// Return list of inactive marks (those that are not yet placed)
export function getInactiveMarks(marks: Marks): string[] {
    return Object.entries(marks)
        .filter(([_, coords]) => coords[0] === 0 || coords[1] === 0)
        .map(([piece, _]) => piece);
}

// Check if a mark is active (placed on board)
export function isMarkActive(marks: Marks, piece: string): boolean {
    const coord = marks[piece as keyof Marks];
    return coord && coord[0] !== 0 && coord[1] !== 0;
}

/**
 * Coordinate conversion utilities
 */

// Convert screen coordinates to SVG coordinates
export function screenToSvgCoordinates(
    clientX: number,
    clientY: number, 
    svgElement: SVGSVGElement
): [number, number] {
    const rect = svgElement.getBoundingClientRect();
    const scaleX = 100 / rect.width;
    const scaleY = 100 / rect.height;
    
    // Calculate continuous coordinates (not snapped to grid)
    const y = (clientX - rect.left) * scaleX;
    const x = (clientY - rect.top) * scaleY;
    
    return [x, y];
}

/**
 * Input handling utilities
 */

// Format command input by adding spaces around vertical bars
export function formatCommandInput(
    value: string, 
    selectionStart: number
): { newValue: string, finalCursorPosition: number } {
    // Only process if the bar character was just typed (cursor position right after a bar)
    const barJustTyped =
        selectionStart > 0 && value.charAt(selectionStart - 1) === "|";

    if (!barJustTyped) {
        return { newValue: value, finalCursorPosition: selectionStart };
    }
    
    const originalPosition = selectionStart;
    let newValue = value;
    let finalCursorPosition: number;

    // Check if we need to add space before the bar (not at start and no space before)
    const addSpaceBefore =
        originalPosition > 1 &&
        value.charAt(originalPosition - 2) !== " ";

    // Always add space after bar
    newValue = `${value.substring(0, originalPosition)} ${value.substring(originalPosition)}`;

    // Add space before if needed
    if (addSpaceBefore) {
        // Calculate position of bar after adding the space after
        const barPosAfterFirstMod = originalPosition;

        // Insert space before the bar
        newValue = `${newValue.substring(0, barPosAfterFirstMod - 1)} ${newValue.substring(barPosAfterFirstMod - 1)}`;

        // Final cursor position will be after the bar and the space we added
        finalCursorPosition = originalPosition + 2; // +1 for space before, +1 for space after
    } else {
        // No space before needed, cursor will be after bar and the space
        finalCursorPosition = originalPosition + 1; // +1 for space after
    }
    
    return { newValue, finalCursorPosition };
}
