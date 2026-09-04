import { buildJobExportWorkbook } from "./jobExportWorkbook";

declare const self: Worker;
self.onmessage = async (event: MessageEvent<Parameters<typeof buildJobExportWorkbook>[0]>) => {
  self.onmessage = null;
  try {
    const result = await buildJobExportWorkbook(event.data);
    self.postMessage({ result }, [result.bytes.buffer]);
  } catch {
    self.postMessage({ error: "Selected jobs could not be exported" });
  }
};
