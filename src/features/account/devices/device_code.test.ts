import { describe, expect, it } from "vitest";
import { formatDeviceCode, isDeviceCode } from "./device_code";

describe("device codes", () => {
  it("reads a typed code in its XXXX-XXXX shape", () => {
    expect(formatDeviceCode("wdjb")).toBe("WDJB");
    expect(formatDeviceCode("wdjbm")).toBe("WDJB-M");
    expect(formatDeviceCode("WDJB-MJHT")).toBe("WDJB-MJHT");
    expect(formatDeviceCode(" wdjb mjht xyz")).toBe("WDJB-MJHT");
  });

  it("keeps only the letters a code is made of", () => {
    expect(formatDeviceCode("A1E-IOU")).toBe("");
    expect(formatDeviceCode("WDJB-")).toBe("WDJB");
  });

  it("accepts only a whole code", () => {
    expect(isDeviceCode("WDJB-MJHT")).toBe(true);
    expect(isDeviceCode("WDJB-MJH")).toBe(false);
    expect(isDeviceCode("wdjb-mjht")).toBe(false);
    expect(isDeviceCode("WDJA-MJHT")).toBe(false);
  });
});
