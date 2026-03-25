import type { OutgoingWebviewMessage } from "./types";

type VsCodeApi = {
  postMessage(message: OutgoingWebviewMessage): void;
};

const maybeAcquire = (
  window as unknown as { acquireVsCodeApi?: () => VsCodeApi }
).acquireVsCodeApi;

export const vscodeApi: VsCodeApi = maybeAcquire
  ? maybeAcquire()
  : {
  postMessage: (_message: OutgoingWebviewMessage) => {
    return;
  },
};
