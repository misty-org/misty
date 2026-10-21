import { afterEach, beforeAll, describe, expect, it } from "vitest";
import parsers from "../../../../src-tauri/src/infra/browser_caption_parsers.js?raw";
import frames from "../../../../src-tauri/src/infra/browser_captions.js?raw";

// Video captions for questions at the cursor are read inside each browser frame by
// src-tauri/src/infra/browser_captions.js (browser_captions_script in browser_scripts.rs).
// These tests load the same files into jsdom.
type Cue = [number, string];
type Parsers = {
  vtt: (text: string) => Cue[];
  srt: (text: string) => Cue[];
  xml: (text: string) => Cue[];
  json: (value: unknown) => Cue[];
  panopto: (body: unknown) => Cue[];
  kaltura: (body: unknown) => Cue[];
  parse: (body: unknown, url?: string) => Cue[];
  looksLikeCaptions: (url: string, type?: string | null) => boolean;
};
type Media = {
  time: number | null;
  paused: boolean;
  hasMedia: boolean;
  captions: Cue[] | null;
  title?: string;
};
type FrameWindow = Window & {
  __mistyFrameMedia?: () => Media | null;
  __mistyFramedMedia?: () => Media | null;
  fetch: typeof fetch;
};

const captions = new Function(`${parsers}\nreturn mistyCaptions;`)() as Parsers;
const script = `(() => {\n${parsers}\n${frames}\n})();`;

// Rows as Panopto's DeliveryInfo.aspx returns them (fields trimmed): the captions list
// (getCaptions=true) and the session's Timestamps, which are slide and chapter titles.
const panoptoCaptionRows = [
  {
    Caption: "Hello! Welcome to our video on company policy.",
    CaptionDuration: 3.233,
    Duration: 0,
    EventTargetType: null,
    Time: 1,
  },
  {
    Caption: "We are glad you are here today.",
    CaptionDuration: 8.918,
    Duration: 0,
    EventTargetType: null,
    Time: 4.233,
  },
];
const panoptoSession = {
  Delivery: {
    SessionName: "Cache Memory",
    Timestamps: [
      {
        Caption: "Cache Memories: Introduction",
        CaptionDuration: null,
        Duration: 60.6,
        EventTargetType: "PowerPoint",
        Time: 0,
        Data: "Cache Memories 15-213",
      },
      {
        Caption: "Storage is a problem",
        CaptionDuration: null,
        Duration: 46.1,
        EventTargetType: "ObjectVideo",
        Time: 148.5,
      },
      {
        Caption: "Spoken in the session",
        CaptionDuration: 2.5,
        Duration: 0,
        EventTargetType: null,
        Time: 150,
      },
    ],
  },
};
const deliveryInfo = "https://school.hosted.panopto.com/Panopto/Pages/Viewer/DeliveryInfo.aspx";

describe("caption files", () => {
  it("reads WebVTT with cue ids, settings, tags and entities", () => {
    const vtt = [
      "WEBVTT",
      "",
      "NOTE produced by the course player",
      "",
      "intro",
      "00:00:01.500 --> 00:00:04.000 align:start position:10%",
      "<v Professor>Welcome to week three &amp; the",
      "<i>midterm</i> review.",
      "",
      "01:02.250 --> 01:05.000",
      "Short clock",
      "",
      "01:00:00.000 --> 01:00:02.000",
      "An hour in",
    ].join("\n");
    expect(captions.vtt(vtt)).toEqual([
      [1.5, "Welcome to week three & the midterm review."],
      [62.25, "Short clock"],
      [3600, "An hour in"],
    ]);
    expect(captions.parse(vtt)).toHaveLength(3);
  });

  it("reads SRT with Windows line endings", () => {
    const srt =
      "1\r\n00:00:02,000 --> 00:00:03,500\r\nFirst line\r\nsecond line\r\n\r\n2\r\n00:01:00,250 --> 00:01:02,000\r\nNext\r\n";
    expect(captions.srt(srt)).toEqual([
      [2, "First line second line"],
      [60.25, "Next"],
    ]);
    expect(captions.parse(srt)).toEqual(captions.srt(srt));
  });

  it("reads YouTube json3 and skips empty events", () => {
    const json3 = {
      events: [
        { tStartMs: 0, dDurationMs: 2000 },
        { tStartMs: 1200, segs: [{ utf8: "so the " }, { utf8: "derivative" }] },
        { tStartMs: 3400, segs: [{ utf8: "\n" }] },
        { tStartMs: 5000, segs: [{ utf8: "is a limit" }] },
      ],
    };
    expect(captions.json(json3)).toEqual([
      [1.2, "so the derivative"],
      [5, "is a limit"],
    ]);
    expect(captions.parse(JSON.stringify(json3))).toEqual(captions.json(json3));
  });

  it("reads TTML/DFXP and YouTube srv3", () => {
    const dfxp = `<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000"><body><div>
      <p begin="00:00:01.00" end="00:00:02.00">Kaltura<br/>caption</p>
      <p begin="25000000t">Ticks</p>
      <p begin="4.5s"><span>Seconds</span></p></div></body></tt>`;
    expect(captions.xml(dfxp)).toEqual([
      [1, "Kaltura caption"],
      [2.5, "Ticks"],
      [4.5, "Seconds"],
    ]);
    const srv3 = `<timedtext format="3"><body><p t="1500" d="900">hello</p><p t="3000" d="900"><s>there</s></p></body></timedtext>`;
    expect(captions.parse(srv3)).toEqual([
      [1.5, "hello"],
      [3, "there"],
    ]);
  });

  it("finds caption lists in other players' JSON", () => {
    const list = {
      transcript: {
        lines: [
          { Caption: "A line", Time: 12.5 },
          { Caption: "Next", Time: 15 },
        ],
      },
    };
    expect(captions.json(list)).toEqual([
      [12.5, "A line"],
      [15, "Next"],
    ]);
    const wrapped = {
      caption: { srclang: "en", data: "1\n00:00:07,000 --> 00:00:08,000\nWrapped SRT\n" },
    };
    expect(captions.json(wrapped)).toEqual([[7, "Wrapped SRT"]]);
    expect(captions.parse({ results: [{ id: 1, name: "not captions" }] })).toEqual([]);
    expect(captions.parse("<html><body>not captions</body></html>")).toEqual([]);
  });

  it("reads only Panopto's caption rows, never slide or chapter titles", () => {
    expect(captions.panopto(panoptoCaptionRows)).toEqual([
      [1, "Hello! Welcome to our video on company policy."],
      [4.233, "We are glad you are here today."],
    ]);
    expect(captions.parse(JSON.stringify(panoptoCaptionRows), deliveryInfo)).toHaveLength(2);
    expect(captions.parse(JSON.stringify(panoptoSession), deliveryInfo)).toEqual([
      [150, "Spoken in the session"],
    ]);
    expect(
      captions.parse(
        { Delivery: { Timestamps: panoptoSession.Delivery.Timestamps.slice(0, 2) } },
        deliveryInfo,
      ),
    ).toEqual([]);
    expect(captions.parse("not json", deliveryInfo)).toEqual([]);
  });

  it("reads Kaltura's caption asset JSON in milliseconds, and nothing else its API answers", () => {
    const multirequest = "https://cdnapisec.kaltura.com/api_v3/service/multirequest";
    // caption_captionasset.serveAsJson, as PlayKit asks for it before CC is on.
    const asset = {
      objects: [
        { startTime: 1460, endTime: 4995, content: [{ text: ">> So with two variables," }] },
        {
          startTime: 4995,
          endTime: 6800,
          content: [{ text: "Bayes rule is pretty\nstraightforward." }],
        },
      ],
    };
    expect(captions.parse(JSON.stringify(asset), multirequest)).toEqual([
      [1.46, ">> So with two variables,"],
      [4.995, "Bayes rule is pretty straightforward."],
    ]);
    expect(captions.parse([asset], multirequest)).toHaveLength(2);
    // The caption list and flavor URLs the same address answers are not captions.
    const list = [
      { totalCount: 1, objects: [{ id: "1_jzl5iave", language: "English", fileExt: "srt" }] },
    ];
    expect(captions.parse(JSON.stringify(list), multirequest)).toEqual([]);
    expect(
      captions.parse(JSON.stringify(["https://cfvod.kaltura.com/pd/a.mp4"]), multirequest),
    ).toEqual([]);
    expect(captions.looksLikeCaptions(multirequest)).toBe(true);
  });

  it("recognizes caption downloads by address or type only", () => {
    expect(captions.looksLikeCaptions(deliveryInfo)).toBe(true);
    expect(
      captions.looksLikeCaptions(
        "https://school.hosted.panopto.com/Panopto/Pages/Viewer.aspx?id=1",
      ),
    ).toBe(false);
    expect(captions.looksLikeCaptions("https://cdn.example/media/en.vtt?sig=1")).toBe(true);
    expect(
      captions.looksLikeCaptions(
        "https://x.kaltura.com/api_v3/service/caption_captionasset/action/serve",
      ),
    ).toBe(true);
    expect(captions.looksLikeCaptions("https://www.youtube.com/api/timedtext?v=abc")).toBe(true);
    expect(
      captions.looksLikeCaptions("https://cdn.example/track/42", "text/vtt; charset=utf-8"),
    ).toBe(true);
    expect(
      captions.looksLikeCaptions("https://canvas.example/api/v1/courses", "application/json"),
    ).toBe(false);
  });
});

describe("frames", () => {
  // The top document runs the script once, as a page would; each test plays in a new frame.
  const top = window as unknown as FrameWindow;
  const pageSaw: unknown[] = [];
  beforeAll(() => {
    new Function(script)();
    window.addEventListener("message", (event) => pageSaw.push(event.data));
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // A frame below the top document. jsdom's postMessage leaves out `source`, so the frame's
  // `window.top` stands in with one that sets it, as a browser does.
  function frame(setup: (child: Window) => void = () => {}) {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const child = iframe.contentWindow!;
    const fakeTop = {
      postMessage: (data: unknown) =>
        setTimeout(() =>
          window.dispatchEvent(
            new MessageEvent("message", { data: structuredClone(data), source: child }),
          ),
        ),
    };
    const proxy = new Proxy(child, {
      get(target, key) {
        if (key === "top") return fakeTop;
        const value = Reflect.get(target, key);
        return typeof value === "function" && !/^[A-Z]/.test(String(key))
          ? value.bind(target)
          : value;
      },
    });
    setup(child);
    new Function("window", "document", "location", "navigator", script)(
      proxy,
      child.document,
      child.location,
      child.navigator,
    );
    return child as unknown as FrameWindow;
  }

  function fakeVideo(
    win: Window,
    options: { time: number; paused: boolean; cues?: Cue[]; mode?: string },
  ) {
    const video = win.document.createElement("video");
    const track = {
      kind: "captions",
      language: "en",
      mode: options.mode ?? "disabled",
      get cues() {
        return this.mode === "disabled"
          ? null
          : (options.cues ?? []).map(([startTime, text]) => ({ startTime, text }));
      },
    };
    Object.defineProperties(video, {
      paused: { get: () => options.paused },
      ended: { get: () => false },
      currentTime: { get: () => options.time },
      duration: { get: () => 600 },
      playbackRate: { get: () => 1 },
      textTracks: { get: () => [track] },
    });
    win.document.body.appendChild(video);
    return { video, track };
  }

  const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

  it("loads a disabled caption track hidden and reads its cues", () => {
    const child = frame();
    const { video, track } = fakeVideo(child, {
      time: 3,
      paused: false,
      cues: [
        [1, "<b>Hello</b> class"],
        [4, "today"],
      ],
    });
    video.dispatchEvent(new Event("play"));
    expect(track.mode).toBe("hidden");
    const media = child.__mistyFrameMedia!();
    expect(media).toMatchObject({ time: 3, paused: false, hasMedia: true });
    expect(media!.captions).toEqual([
      [1, "Hello class"],
      [4, "today"],
    ]);
  });

  it("keeps the track a page shows as it is", () => {
    const child = frame();
    const { video, track } = fakeVideo(child, {
      time: 3,
      paused: false,
      mode: "showing",
      cues: [[1, "Shown"]],
    });
    video.dispatchEvent(new Event("play"));
    expect(track.mode).toBe("showing");
  });

  it("captures a caption file the page fetched, without fetching it again", async () => {
    const requests: string[] = [];
    const body = "WEBVTT\n\n00:00:05.000 --> 00:00:06.000\nFrom the network\n";
    const child = frame((win) => {
      (win as unknown as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response(body, { headers: { "content-type": "text/vtt" } });
      }) as typeof fetch;
    });
    const reply = await child.fetch("https://cdnapisec.kaltura.com/captions/en.vtt");
    // The page still reads the whole body itself.
    expect(await reply.text()).toBe(body);
    await settle();
    fakeVideo(child, { time: 5, paused: false, mode: "showing" });
    expect(child.__mistyFrameMedia!()!.captions).toEqual([[5, "From the network"]]);
    expect(requests).toEqual(["https://cdnapisec.kaltura.com/captions/en.vtt"]);
  });

  it("reads the captions Panopto's viewer posts for, and a second language replaces the first", async () => {
    const replies: Record<string, unknown> = {
      session: panoptoSession,
      "0": panoptoCaptionRows,
      "3": [
        {
          Caption: "Hola a todos.",
          CaptionDuration: 2,
          Duration: 0,
          EventTargetType: null,
          Time: 1,
        },
      ],
    };
    const child = frame((win) => {
      (win as unknown as { fetch: typeof fetch }).fetch = (async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const form = new URLSearchParams(String(init?.body ?? ""));
        const reply = form.get("getCaptions")
          ? replies[form.get("language") ?? "0"]
          : replies.session;
        return new Response(JSON.stringify(reply), {
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;
    });
    const post = (body: string) => child.fetch(deliveryInfo, { method: "POST", body });
    await post("deliveryId=abc&isEmbed=true&responseType=json");
    await settle();
    fakeVideo(child, { time: 2, paused: false, mode: "showing" });
    // The session's slide and chapter titles are not captions.
    expect(child.__mistyFrameMedia!()!.captions).toEqual([[150, "Spoken in the session"]]);
    await post("deliveryId=abc&getCaptions=true&language=0&responseType=json");
    await settle();
    expect(child.__mistyFrameMedia!()!.captions).toEqual([
      [1, "Hello! Welcome to our video on company policy."],
      [4.233, "We are glad you are here today."],
    ]);
    await post("deliveryId=abc&getCaptions=true&language=3&responseType=json");
    await settle();
    expect(child.__mistyFrameMedia!()!.captions).toEqual([[1, "Hola a todos."]]);
  });

  it("passes XMLHttpRequest.open to the page's own and reads caption files it loads", () => {
    const opened: string[] = [];
    // The page's XMLHttpRequest, as a player (Kaltura's PlayKit) uses it.
    class PageRequest extends EventTarget {
      status = 0;
      responseURL = "";
      responseType = "";
      responseText = "";
      open(_method: string, url: string) {
        opened.push(url);
        this.responseURL = url;
      }
      getResponseHeader() {
        return "text/vtt";
      }
      finish(body: string) {
        this.status = 200;
        this.responseText = body;
        this.dispatchEvent(new Event("load"));
      }
    }
    const child = frame((win) => {
      (win as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = PageRequest;
    });
    const Request = (child as unknown as { XMLHttpRequest: typeof PageRequest }).XMLHttpRequest;
    const request = new Request();
    const url =
      "https://cdnapisec.kaltura.com/api_v3/service/caption_captionasset/action/serveWebVTT/en.vtt";
    request.open("GET", url);
    expect(opened).toEqual([url]);
    request.finish("WEBVTT\n\n00:00:09.000 --> 00:00:10.000\nOver XHR\n");
    fakeVideo(child, { time: 9, paused: false, mode: "showing" });
    expect(child.__mistyFrameMedia!()!.captions).toEqual([[9, "Over XHR"]]);
  });

  it("ignores reports that do not come from a frame below", async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          __mistyFrameMedia: 1,
          time: 1,
          paused: false,
          hasMedia: true,
          captions: [[1, "forged"]],
        },
        source: window,
      }),
    );
    await settle();
    expect(top.__mistyFramedMedia!()).toBeNull();
  });

  it("gathers a playing frame's video and captions in the top document", async () => {
    const child = frame();
    const { video } = fakeVideo(child, {
      time: 42,
      paused: false,
      cues: [
        [40, "In a frame"],
        [43, "below Canvas"],
      ],
    });
    video.dispatchEvent(new Event("play"));
    await settle(250);
    const framed = top.__mistyFramedMedia!();
    expect(framed).toMatchObject({ paused: false, hasMedia: true });
    expect(framed!.time).toBeGreaterThanOrEqual(42);
    expect(framed!.captions).toEqual([
      [40, "In a frame"],
      [43, "below Canvas"],
    ]);
    // The page around the frame never sees these messages.
    expect(pageSaw).toEqual([]);
  });
});
