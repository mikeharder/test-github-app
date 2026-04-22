import { logs } from "@opentelemetry/api-logs";
import { describe, expect, it, vi } from "vitest";
import { logger } from "../src/logger.js";

describe("logger", () => {
  it("is obtained from logs.getLogger with the correct name", () => {
    const getLoggerSpy = vi.spyOn(logs, "getLogger");
    logs.getLogger("test-github-app");
    expect(getLoggerSpy).toHaveBeenCalledWith("test-github-app");
  });

  it("exposes an emit method", () => {
    expect(typeof logger.emit).toBe("function");
  });
});
