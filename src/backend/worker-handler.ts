import { gunzipSync } from "node:zlib";
import type { CloudWatchLogsEvent, EventBridgeEvent } from "aws-lambda";
import { ingestSignal, type IncidentSignal, service } from "./service";

interface CloudWatchBatch {
  messageType: string;
  logEvents: { id: string; timestamp: number; message: string }[];
}

export function parseCloudWatchSignals(data: string): IncidentSignal[] {
  const batch = JSON.parse(gunzipSync(Buffer.from(data, "base64")).toString("utf8")) as CloudWatchBatch;
  if (batch.messageType === "CONTROL_MESSAGE") return [];
  return batch.logEvents.flatMap((event) => {
    try {
      const decoded = JSON.parse(event.message) as IncidentSignal | { message?: string | IncidentSignal };
      const candidate = "event_type" in decoded
        ? decoded
        : typeof decoded.message === "string"
          ? JSON.parse(decoded.message) as IncidentSignal
          : decoded.message;
      const parsed = candidate as IncidentSignal;
      return parsed.event_type === "incident_signal" ? [parsed] : [];
    } catch {
      try {
        const parsed = JSON.parse(event.message.slice(event.message.indexOf("{"))) as IncidentSignal;
        return parsed.event_type === "incident_signal" ? [parsed] : [];
      } catch {
        return [];
      }
    }
  });
}

export const handler = async (event: CloudWatchLogsEvent | EventBridgeEvent<"Scheduled Event", Record<string, unknown>>) => {
  if ("awslogs" in event) {
    const signals = parseCloudWatchSignals(event.awslogs.data);
    await Promise.all(signals.map(ingestSignal));
    return;
  }
  const deleted = await service.cleanupExpiredWorkspaces();
  console.log(JSON.stringify({ stage: "workspace_cleanup", deleted }));
};
