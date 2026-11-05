"use client";

// What the audience screen shows on top of the slide (blank, join info) is screen-only state:
// the students never need it. Presenter control and the audience screen are windows of the same
// browser, so they pass it over a BroadcastChannel instead of the server.

import { useCallback, useEffect, useRef, useState } from "react";

export interface ScreenLayers {
  blank: boolean;
  join: boolean;
}

type Message = { type: "set"; layers: ScreenLayers } | { type: "ask" };

const channelName = (sessionId: string) => `moddeck-screen:${sessionId}`;

/**
 * The screen layers, shared by every window of this session in the browser. Any window can
 * change them; a window that opens later asks the others for the current value.
 */
export function useScreenLayers(
  sessionId: string,
): [ScreenLayers, (next: Partial<ScreenLayers>) => void] {
  const [layers, setLayers] = useState<ScreenLayers>({ blank: false, join: false });
  const layersRef = useRef(layers);
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    layersRef.current = layers;
  });

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel(channelName(sessionId));
    channel.current = bc;
    bc.onmessage = ({ data }: MessageEvent<Message>) => {
      if (data.type === "set") setLayers(data.layers);
      else bc.postMessage({ type: "set", layers: layersRef.current } satisfies Message);
    };
    bc.postMessage({ type: "ask" } satisfies Message);
    return () => {
      bc.close();
      channel.current = null;
    };
  }, [sessionId]);

  const update = useCallback((next: Partial<ScreenLayers>) => {
    const layers = { ...layersRef.current, ...next };
    layersRef.current = layers;
    setLayers(layers);
    channel.current?.postMessage({ type: "set", layers } satisfies Message);
  }, []);

  return [layers, update];
}
