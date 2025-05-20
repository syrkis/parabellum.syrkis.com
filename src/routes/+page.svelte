<script lang="ts">
    import { onMount } from "svelte";
    import { init, reset, step, close, getPieceIndex, PIECE_TYPES, syncMarks, localSize } from "../lib/api";
    import {
        API_BASE_URL,
        chessSymbols,
        markOrder,
        DRAG_THRESHOLD,
        processCommand,
        processCommands,
        getActiveMarks,
        getInactiveMarks,
        isMarkActive,
        screenToSvgCoordinates,
        formatCommandInput
    } from "../lib/utils";
    import type {
        LogEntry,
        ChatEntry,
        State,
        Scene,
        Marks,
    } from "../lib/types";

    // Convert messages to use $state for reactivity
    let messages = $state<ChatEntry[]>([{ text: "Welcome!", user: "system" }]);
    let marks = $state<Marks>({
        king: [0, 0],
        queen: [0, 0],
        bishop: [0, 0],
        knight: [0, 0],
        rook: [0, 0],
        pawn: [0, 0]
    });
    let gameId = $state<string | null>(null);
    let gameState = $state<State | null>(null);
    let scene = $state<Scene>({
        terrain: [...Array(localSize)].map(() => Array(localSize).fill(0)),
    });
    let logs = $state<LogEntry[]>([]);
    let error = $state<string | null>(null);
    let loading = $state(false);
    let gameLoopActive = $state(false);
    let gameLoopInterval: number | null = $state(null);

    // Command history implementation
    let commandHistory = $state<string[]>([]);
    let historyIndex = $state<number>(-1);
    let isDragging = $state<string | null>(null); // Piece being dragged
    let dragOffsetX = $state<number>(0);
    let dragOffsetY = $state<number>(0);
    let justFinishedDragging = $state<boolean>(false); // Track if we just finished dragging

    // Variable to track if we're just starting to drag
    let dragStartTime = $state<number>(0);

    // Log function to track API calls and results
    function addLog(message: string): void {
        logs = [...logs, { time: new Date().toLocaleTimeString(), message }];
    }

    function addMessage(message: ChatEntry): void {
        messages = [...messages, message];
    }

    // Create a handlers object for the command processor
    const commandHandlers = {
        initGame,
        resetGame,
        stepGame,
        closeGame,
        toggleGameLoop
    };

    // Wrapper for processCommand that uses our local handler functions
    async function handleCommand(command: string): Promise<void> {
        await processCommand(command, commandHandlers, addLog);
    }

    // Wrapper for processCommands that uses our local handler functions
    async function handleCommands(commandText: string): Promise<void> {
        await processCommands(commandText, commandHandlers, addLog);
    }

    // Handle form submission
    async function handleSubmit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        const messageInput = document.getElementById(
            "messageInput",
        ) as HTMLInputElement;
        const messageText = messageInput.value.trim();

        // If empty message, run step command silently
        if (!messageText) {
            await stepGame();
            return;
        }

        // If command (starts with |), add to history but don't show in chat
        if (messageText.startsWith("|")) {
            // Add to command history
            commandHistory = [...commandHistory, messageText];
            historyIndex = -1;

            // Process the command(s) using our wrapper function
            await handleCommands(messageText);
        } else {
            // If it's not a command, add it to the chat as a regular message
            addMessage({
                text: messageText,
                user: "person",
            });
        }

        // Clear the input field
        messageInput.value = "";

        // Remove command mode class when input is cleared
        messageInput.classList.remove("command-mode");

        // Ensure input stays focused
        messageInput.focus();
    }

    // Initialize a new game
    async function initGame(): Promise<void> {
        loading = true;
        error = null;
        try {
            addLog("Initializing game for Copenhagen, Denmark...");
            const initResponse = await init("Copenhagen, Denmark");
            gameId = initResponse.game_id;
            scene = initResponse.scene;

            // Set the marks from the initial state
            marks = initResponse.marks;

            // Log detailed information
            addLog(`Game initialized with ID: ${gameId}`);
            addLog(
                `Terrain data received: ${scene.terrain ? scene.terrain.length : 0} buildings`,
            );

            // Log the initial marks positions
            const activeMarks = getActiveMarksList();

            if (activeMarks.length > 0) {
                addLog(`Initial marks set: ${activeMarks.join(', ')}`);
            } else {
                addLog("No initial marks set. Click on simulator to place marks.");
            }

            addLog(
                `Terrain loaded for Copenhagen, Denmark. Use '| reset' to prepare the game.`,
            );
        } catch (err: unknown) {
            const errorMessage =
                err instanceof Error ? err.message : String(err);
            error = `Init error: ${errorMessage}`;
            addLog(`Error: ${error}`);
        } finally {
            loading = false;
        }
    }

    // Reset the current game
    async function resetGame(): Promise<void> {
        if (!gameId) {
            addLog("No game to reset. Initialize a game first with '| init'.");
            return;
        }

        loading = true;
        error = null;
        try {
            // Now reset the game
            addLog(`Resetting game ${gameId}...`);
            gameState = await reset(gameId, scene);
            addLog(`Game reset. Current step: ${gameState.step}`);

            // Count active marks for the log message
            const activeMarks = getActiveMarksList();
            if (activeMarks.length > 0) {
                addLog(`Game reset with ${activeMarks.length} active marks: ${activeMarks.join(', ')}`);
            }

            addLog(
                `Units placed on the map. Use '| step' or press Enter to advance the simulation.`,
            );
        } catch (err: unknown) {
            const errorMessage =
                err instanceof Error ? err.message : String(err);
            error = `Reset error: ${errorMessage}`;
            addLog(`Error: ${error}`);
        } finally {
            loading = false;
        }
    }

    // Advance the game state
    async function stepGame(): Promise<void> {
        if (!gameId) {
            addLog(
                "No game to step. Initialize and reset a game first with '| init'.",
            );
            return;
        }

        loading = true;
        error = null;
        try {

            // Now step the game
            addLog(`Stepping game ${gameId}...`);
            gameState = await step(gameId, scene);
            addLog(`Game stepped. Current step: ${gameState.step}`);

            // Log number of units
            let unitCount = 0;
            if (gameState.unit && gameState.unit.length > 0) {
                unitCount = gameState.unit.length;
                addLog(`Units in game: ${unitCount}`);
            }

            addLog(
                `Step ${gameState.step} completed. ${unitCount} units active.`,
            );
        } catch (err: unknown) {
            const errorMessage =
                err instanceof Error ? err.message : String(err);
            error = `Step error: ${errorMessage}`;
            addLog(`Error: ${error}`);
        } finally {
            loading = false;
        }
    }

    // close current game
    async function closeGame(): Promise<void> {
        if (!gameId) {
            addLog("No game to close.");
            return;
        }

        // If game loop is active, stop it
        if (gameLoopActive && gameLoopInterval !== null) {
            clearInterval(gameLoopInterval);
            gameLoopInterval = null;
            gameLoopActive = false;
            addLog("Game loop stopped.");
        }

        loading = true;
        error = null;
        try {
            const currentGameId = gameId;
            addLog(`Closing game ${currentGameId}...`);

            // Count active marks for logging
            const activeMarksCount = getActiveMarksList().length;

            await close(currentGameId);
            addLog("Game closed successfully.");

            // Reset all game state
            gameId = null;
            gameState = null;
            scene = {
                terrain: Array(localSize)
                    .fill(0)
                    .map(() => Array(localSize).fill(0)),
            };

            // Reset all marks to inactive (0,0)
            marks = {
                king: [0, 0],
                queen: [0, 0],
                bishop: [0, 0],
                knight: [0, 0],
                rook: [0, 0],
                pawn: [0, 0]
            };

            // Add informative log including mark cleanup
            addLog(
                `Game ${currentGameId.substring(0, 8)}... closed successfully. ${activeMarksCount > 0 ? `${activeMarksCount} marks removed. ` : ''}Use '| init' to start a new game.`
            );
        } catch (err: unknown) {
            const errorMessage =
                err instanceof Error ? err.message : String(err);
            error = `Close error: ${errorMessage}`;
            addLog(`Error: ${error}`);
        } finally {
            loading = false;
        }
    }

    // Toggle the game loop (play/pause)
    function toggleGameLoop(): void {
        // Check if we have a game initialized
        if (!gameId) {
            addLog("No game to play. Initialize and reset a game first with '| init' and '| reset'.");
            return;
        }

        // Toggle the game loop state
        if (gameLoopActive) {
            // Pause the game loop
            if (gameLoopInterval !== null) {
                clearInterval(gameLoopInterval);
                gameLoopInterval = null;
            }
            gameLoopActive = false;
            addLog("Game loop paused.");
        } else {
            // Start the game loop with 500ms interval
            gameLoopInterval = setInterval(async () => {
                try {
                    await stepGame();
                } catch (err) {
                    // If we encounter an error, stop the game loop
                    if (gameLoopInterval !== null) {
                        clearInterval(gameLoopInterval);
                        gameLoopInterval = null;
                        gameLoopActive = false;
                        addLog("Game loop stopped due to error.");
                    }
                }
            }, 100) as unknown as number;
            gameLoopActive = true;
            addLog("Game loop started (stepping every 100ms). Run '| play' again to pause.");
        }
    }

    // Close the current game
    // Handle auto-adding space after vertical bar and command history navigation
    function handleKeydown(event: KeyboardEvent): void {
        const input = event.target as HTMLInputElement;

        // Handle up/down arrows for command history
        if (event.key === "ArrowUp") {
            if (
                commandHistory.length > 0 &&
                historyIndex < commandHistory.length - 1
            ) {
                historyIndex++;
                input.value =
                    commandHistory[commandHistory.length - 1 - historyIndex];
                // Set cursor at the end
                setTimeout(() => {
                    input.selectionStart = input.selectionEnd =
                        input.value.length;
                }, 0);
                event.preventDefault();

                // Update command mode class
                if (input.value.trim().startsWith("|")) {
                    input.classList.add("command-mode");
                } else {
                    input.classList.remove("command-mode");
                }
            }
        } else if (event.key === "ArrowDown") {
            if (historyIndex > 0) {
                historyIndex--;
                input.value =
                    commandHistory[commandHistory.length - 1 - historyIndex];
            } else if (historyIndex === 0) {
                historyIndex = -1;
                input.value = "";
            }
            event.preventDefault();

            // Update command mode class
            if (input.value.trim().startsWith("|")) {
                input.classList.add("command-mode");
            } else {
                input.classList.remove("command-mode");
            }
        }
    }

    // Auto-add spaces before and after vertical bar
    function handleInput(event: Event): void {
        const input = event.target as HTMLInputElement;
        const value = input.value;
        const selectionStart = input.selectionStart || 0;

        // Toggle command-mode class based on if input starts with |
        if (value.trim().startsWith("|")) {
            input.classList.add("command-mode");
        } else {
            input.classList.remove("command-mode");
        }

        // Use the utility function to format the command input
        const { newValue, finalCursorPosition } = formatCommandInput(value, selectionStart);

        // Only update if the formatting changed something
        if (newValue !== value) {
            // Update the input value
            input.value = newValue;

            // Position cursor correctly
            setTimeout(() => {
                input.selectionStart = input.selectionEnd = finalCursorPosition;
            }, 0);
        }
    }
    // function grow(node) {
    //     if (node.getAttribute("r") === "0") {
    //         setTimeout(() => node.setAttribute("r", "1"), 10);
    //     }
    //     return {};
    // }

    // Handle click on the simulator to place marks (removal is handled by handleDragEnd)
    async function handleSimulatorClick(event: MouseEvent): Promise<void> {
        // Skip if we're currently dragging or just finished dragging
        if (isDragging || justFinishedDragging) {
            event.stopPropagation();
            return;
        }

        // Skip if no game is active
        // if (!gameId) {
            // addLog("Cannot place mark: No active game. Initialize a game with '| init' first.");
            // return;
        // }

        // Get click coordinates relative to the SVG using utility function
        const svg = event.currentTarget as SVGSVGElement;
        const [x, y] = screenToSvgCoordinates(event.clientX, event.clientY, svg);

        // We're only using this handler for placing new marks now
        // Removal is handled by the mark's own drag/click detection

        // Get the leftmost available symbol instead of using the currentMarkIndex
        const inactiveMarks = getInactiveMarksList();

        // If we have inactive marks, place the leftmost one
        if (inactiveMarks.length > 0) {
            // Find the leftmost inactive mark by finding the one with lowest index in markOrder
            const leftmostMark = inactiveMarks.reduce((leftmost, current) => {
                const leftmostIndex = markOrder.indexOf(leftmost);
                const currentIndex = markOrder.indexOf(current);
                return currentIndex < leftmostIndex ? current : leftmost;
            });

            // First update locally for immediate UI feedback
            marks[leftmostMark as keyof Marks] = [x, y];
            addLog(`Placing ${leftmostMark} at [${x.toFixed(1)}, ${y.toFixed(1)}]...`);

            // Then synchronize with the backend
            // await syncMarkWithBackend(leftmostMark, [x, y]);
        }
        if (gameId && scene?.cfg) {
            syncMarks(gameId, marks, scene.cfg.size);
        }

        // Refocus the input field
        focusInput();
    }

    // Wrappers for mark utility functions that pass our local marks state
    function getActiveMarksList(): string[] {
        return getActiveMarks(marks);
    }

    function getInactiveMarksList(): string[] {
        return getInactiveMarks(marks);
    }

    function isMarkActivePiece(piece: string): boolean {
        return isMarkActive(marks, piece);
    }

    // Variables for dragging functionality

    // Start dragging a mark
    function handleDragStart(event: MouseEvent, piece: string): void {
        event.preventDefault();
        // Find the SVG parent
        let target = event.currentTarget as Element;
        while (target && target.tagName !== 'svg') {
            target = target.parentElement as Element;
        }
        const svg = target as SVGSVGElement;
        if (!svg) return;

        const coords = marks[piece as keyof Marks];
        if (!coords || coords[0] === 0) return;

        // Record the drag start time to distinguish from clicks
        dragStartTime = Date.now();

        isDragging = piece;

        // Get current pointer position in SVG coordinates using utility function
        const [pointerX, pointerY] = screenToSvgCoordinates(event.clientX, event.clientY, svg);

        // Calculate offset from the center of the mark
        dragOffsetX = coords[0] - pointerX;
        dragOffsetY = coords[1] - pointerY;
    }

    // Handle moving a mark being dragged
    async function handleDragMove(event: MouseEvent): Promise<void> {
        if (!isDragging) return;

        const svg = event.currentTarget as SVGSVGElement;

        // Calculate new position in SVG coordinates using utility function
        const [baseX, baseY] = screenToSvgCoordinates(event.clientX, event.clientY, svg);
        const x = baseX + dragOffsetX;
        const y = baseY + dragOffsetY;

        // Update mark position locally immediately for responsive UI
        marks[isDragging as keyof Marks] = [x, y];
    }

    // End dragging
    async function handleDragEnd(event: MouseEvent): Promise<void> {
        if (isDragging) {
            // Prevent the default event
            event.preventDefault();
            event.stopPropagation();

            // Calculate how long the drag/click lasted
            const dragDuration = Date.now() - dragStartTime;

            // If it was a short interaction, treat it as a click and remove the mark
            if (dragDuration < DRAG_THRESHOLD) {
                // Reset the mark position locally (remove it)
                marks[isDragging as keyof Marks] = [0, 0];
                addLog(`Removing ${isDragging} mark...`);

                // Sync with backend
                // await syncMarkWithBackend(isDragging, [0, 0]);
            } else {
                // It was a real drag operation
                // Get the current position of the dragged mark
                const newPosition = marks[isDragging as keyof Marks];
                addLog(`Moving ${isDragging} to [${newPosition[0].toFixed(1)}, ${newPosition[1].toFixed(1)}]...`);

                // Sync the new position with backend
                // await syncMarkWithBackend(isDragging, [newPosition[0], newPosition[1]]);

                // Set the flag to indicate we just finished dragging
                justFinishedDragging = true;

                // Reset the flag after a short delay
                setTimeout(() => {
                    justFinishedDragging = false;
                }, 100);
            }

            // Clear dragging state
            isDragging = null;
            if (gameId && scene?.cfg) {
                syncMarks(gameId, marks, scene.cfg.size);
            }

            // Refocus the input field
            focusInput();
        }
    }




    // Utility function to focus the input field
    function focusInput(): void {
        setTimeout(() => {
            const messageInput = document.getElementById("messageInput") as HTMLInputElement;
            if (messageInput) {
                messageInput.focus();
            }
        }, 0);
    }

    // Display API Base URL for debugging
    onMount(() => {
        addLog(`API Base URL: ${API_BASE_URL}`);

        // Initialize command mode for input field if needed
        const messageInput = document.getElementById(
            "messageInput",
        ) as HTMLInputElement;
        if (messageInput?.value.trim().startsWith("|")) {
            messageInput.classList.add("command-mode");
        }

        // Log available marks
        addLog(`Available marks: ${markOrder.join(", ")}`);

        // Focus the input field when component loads
        focusInput();

        // Return a cleanup function to ensure intervals are cleared when component is destroyed
        return () => {
            // Clean up any active interval
            if (gameLoopInterval !== null) {
                clearInterval(gameLoopInterval);
                gameLoopInterval = null;
            }
        };
    });
</script>



<main class="container">
    {#if error}
        <div class="error">
            <strong>Error:</strong>
            {error}
        </div>
    {/if}

    <div id="simulator">
        <!-- Using a semantically interactive element (div with role) for the simulator wrapper -->
        <div
            role="button"
            tabindex="0"
            aria-label="Simulator - click to place or remove marks"
            style="width: 100%; height: 100%; padding: 0; border: none; background: none; display: block;"
            onclick={handleSimulatorClick}
            onmousemove={handleDragMove}
            onmouseup={handleDragEnd}
            onmouseleave={handleDragEnd}
            onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const div = e.currentTarget as HTMLDivElement;
                    const mockEvent = {
                        currentTarget: div.querySelector('svg'),
                        clientX: div.getBoundingClientRect().width / 2,
                        clientY: div.getBoundingClientRect().height / 2,
                        preventDefault: () => {}
                    } as unknown as MouseEvent;
                    handleSimulatorClick(mockEvent);
                    focusInput();
                }
            }}
        >
        <svg
            viewBox="0 0 100 100"
            width="100%"
            height="100%"
            preserveAspectRatio="xMidYMid meet"
        >
            {#each scene.terrain as row, i}
                {#each row as col, j}
                    <rect
                        x={j - (col / 2 + 0.1) / 2 + 0.5}
                        y={i - (col / 2 + 0.1) / 2 + 0.5}
                        height={col / 2 + 0.1}
                        width={col / 2 + 0.1}
                    />
                {/each}
            {/each}

            {#if gameState && scene.cfg}
                {#each gameState.unit as unit, i (unit.id || i)}
                    <circle
                        cx={unit.y}
                        cy={unit.x}
                        r={gameState.step <= 1 ? "0" : "1"}
                        fill={`var(--${scene.cfg.teams[i] === 0 ? "red" : "blue"})`}
                    />
                {/each}
            {/if}

            <!-- Display placed marks with chess symbols -->
            {#each Object.entries(marks) as [piece, coords]}
                {#if coords[0] !== 0 && coords[1] !== 0}
                    <g
                        class="mark interactive-mark"
                        transform={`translate(${coords[1]}, ${coords[0]})`}
                        onmousedown={(e) => {
                            e.stopPropagation(); // Stop event from bubbling up to SVG
                            handleDragStart(e, piece);
                        }}
                        role="button"
                        tabindex="0"
                        onkeydown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.stopPropagation();
                                e.preventDefault();
                                handleDragStart(e as unknown as MouseEvent, piece);
                            }
                        }}
                        aria-label={`Draggable ${piece} piece`}
                        data-tooltip={piece}
                    >
                        <!-- Large invisible clickable area -->
                        <circle
                            cx="0"
                            cy="0"
                            r="3"
                            fill="transparent"
                            stroke="transparent"
                        />
                        <text
                            x="0"
                            y="0.7"
                            text-anchor="middle"
                            dominant-baseline="middle"
                            font-size="7"
                            >
                            <title>{piece}</title>
                            {chessSymbols[piece]}
                        </text>
                    </g>
                {/if}
            {/each}
        </svg>
        </div>
    </div>

    <div id="controler" onclick={focusInput} onkeydown={(e) => e.key === 'Enter' && focusInput()} role="region" aria-label="Control panel">
        <!-- chat history - will grow/shrink based on available space -->
        <div class="chat-history" onclick={focusInput} onkeydown={(e) => e.key === 'Enter' && focusInput()} role="log" aria-label="Chat messages">
            {#each messages as message}
                {#if message.user === "system"}
                    <div class="system">{message.text}</div>
                {:else}
                    <div class="person">{message.text}</div>
                {/if}
            {/each}
        </div>

        <!-- Fixed elements at the bottom -->
        <div class="marks" onclick={focusInput} onkeydown={(e) => e.key === 'Enter' && focusInput()} role="toolbar" aria-label="Available pieces" tabindex="0">
            <!-- Show all marks in fixed positions with active/inactive state -->
            <div class="mark-container">
                {#each markOrder as piece}
                    {#if !isMarkActivePiece(piece)}
                        <div class="mark-item" title="{piece}">
                            {chessSymbols[piece]}
                        </div>
                    {:else}
                        <div class="mark-item-placeholder" title="{piece}">
                        </div>
                    {/if}
                {/each}
            </div>
        </div>
        <div class="bottom-section">
            <!-- chat input -->
            <form onsubmit={handleSubmit} autocomplete="off">
                <div class="input-container">
                    <input
                        type="text"
                        class="input-container command-mode"
                        id="messageInput"
                        placeholder="Type command (| i, | r, | s, | c, | h) or press Enter for step"
                        onkeydown={handleKeydown}
                        oninput={handleInput}
                        autocomplete="off"
                        autofocus
                    />
                </div>
            </form>

            <!-- log history -->
            <div class="log-history" onclick={focusInput} onkeydown={(e) => e.key === 'Enter' && focusInput()} role="log" aria-label="System log">
                {#each [...logs].reverse() as log}
                    <div class="log-entry">
                        <span class="log-time">[{log.time}]</span>
                        <span class="log-message">{log.message}</span>
                    </div>
                {/each}
            </div>
        </div>
    </div>
</main>
