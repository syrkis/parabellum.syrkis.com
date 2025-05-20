// websocket.ts - Update to use the API_BASE_URL

import { API_BASE_URL } from "./utils";
import type { State } from "./types";

export class GameStateSocket {
  private socket: WebSocket | null = null;
  private gameId: string;
  private onStateUpdate: (state: State) => void;

  constructor(gameId: string, onStateUpdate: (state: State) => void) {
    this.gameId = gameId;
    this.onStateUpdate = onStateUpdate;
  }

  connect(): void {
    this.disconnect();

    // Use the shared API_BASE_URL
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsBaseUrl = API_BASE_URL.replace(/^https?:\/\//, `${wsProtocol}//`);
    this.socket = new WebSocket(`${wsBaseUrl}/ws/${this.gameId}`);

    // Rest of the code remains the same
    this.socket.onopen = () => {
      console.log("WebSocket connection established");
    };

    this.socket.onmessage = (event) => {
      try {
        const state: State = JSON.parse(event.data);
        this.onStateUpdate(state);
      } catch (error) {
        console.error("Error parsing WebSocket message:", error);
      }
    };

    this.socket.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    this.socket.onclose = (event) => {
      console.log("WebSocket closed:", event);
      this.socket = null;
    };
  }

  // Rest of the class remains the same
  disconnect(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
    this.socket = null;
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }
}
