import { expect, it, vi } from "vitest";
import { DeviceOperationNotAttempted } from "./workerBrowserJobs";
import { deviceJobFailure } from "./workerJobOutcome";

vi.mock("@/api/client", () => ({ apiBlobRequest: vi.fn() }));

it("calls a browser action that began and went quiet uncertain", () => {
  expect(deviceJobFailure("browser.steps", new Error("private detail"), true)).toEqual({
    uncertain: true,
    errorCode: "device_execution_uncertain",
  });
});

it("is certain before it began", () => {
  expect(deviceJobFailure("browser.steps", new Error("lost"), false).uncertain).toBe(false);
});

it("is certain when it never reached the page, or only read", () => {
  const notAttempted = new DeviceOperationNotAttempted(new Error("browser_context_closed"));
  expect(deviceJobFailure("browser.steps", notAttempted, true)).toEqual({
    uncertain: false,
    errorCode: "browser_tab_closed",
  });
  const webview = new Error("failed to send message to the webview");
  expect(deviceJobFailure("browser.steps", webview, true).errorCode).toBe(
    "browser_webview_unavailable",
  );
  expect(deviceJobFailure("browser.snapshot", new Error("lost"), true).uncertain).toBe(false);
});

it("is never uncertain outside the browser", () => {
  expect(deviceJobFailure("shell.run", new Error("lost"), true).uncertain).toBe(false);
});
