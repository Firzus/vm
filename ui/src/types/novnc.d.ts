declare module "@novnc/novnc" {
  type RFBOptions = {
    credentials?: { username?: string; password?: string; target?: string };
    shared?: boolean;
    repeaterID?: string;
    wsProtocols?: string[];
  };

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string, options?: RFBOptions);
    viewOnly: boolean;
    focusOnClick: boolean;
    clipViewport: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    background: string;
    qualityLevel: number;
    compressionLevel: number;
    capabilities: { power: boolean };

    disconnect(): void;
    sendCredentials(credentials: RFBOptions["credentials"]): void;
    sendKey(keysym: number, code: string, down?: boolean): void;
    sendCtrlAltDel(): void;
    focus(): void;
    blur(): void;
    machineShutdown(): void;
    machineReboot(): void;
    machineReset(): void;
    clipboardPasteFrom(text: string): void;
  }
}
