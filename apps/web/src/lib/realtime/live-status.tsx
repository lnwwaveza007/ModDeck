"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ConnectionStatus } from "./live-connection";

const LiveStatusContext = createContext<ConnectionStatus>("connecting");

/**
 * Gives the live screens the connection status. A control that sends something (vote, word,
 * question, upvote, reaction) calls useCanSend() and disables itself while it is false, so a
 * student never believes something was sent when it was not (MD-5 rule 6).
 */
export function LiveStatusProvider({
  status,
  children,
}: {
  status: ConnectionStatus;
  children: ReactNode;
}) {
  return <LiveStatusContext.Provider value={status}>{children}</LiveStatusContext.Provider>;
}

export const useLiveStatus = () => useContext(LiveStatusContext);

/** True only when the server can confirm what we send. */
export const useCanSend = () => useLiveStatus() === "online";
