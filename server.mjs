// server.mjs
import http from "http";
import { URL } from "url";
import ffmpeg from "fluent-ffmpeg";
import fetch from "node-fetch";
import { PassThrough } from "stream";

const PORT = process.env.PORT || 3000;

function log(...args) {
  console.log("[mux-service]", ...args);
}

// download helper → Buffer
async function fetchBuffer(url) {
  log("Downloading", url);
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Failed to download: ${res.status} ${txt}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

function muxAudioVideo(videoBuf, audioBuf) {
  return new Promise((resolve, reject) => {
    // PassThrough already imported from "stream" at the top
    const vStream = new PassThrough();
    const aStream = new PassThrough();

    vStream.end(videoBuf);
    aStream.end(audioBuf);

    const outStream = new PassThrough();
    const chunks = [];

    outStream.on("data", (c) => chunks.push(c));
    outStream.on("end", () => resolve(Buffer.concat(chunks)));
    outStream.on("error", reject);

    ffmpeg()
      .input(vStream)
      .input(aStream)
      .outputOptions(["-c:v copy", "-c:a aac"])
      .format("mp4")
      .on("error", (err) => reject(err))
      .pipe(outStream);
  });
}

// upload result somewhere (for now we just return base64 URL)
// You can later swap this to Supabase storage if you want.
async function handleMux(videoUrl, audioUrl, res) {
  try {
    log("Start mux", { videoUrl, audioUrl });

    const [vBuf, aBuf] = await Promise.all([
      fetchBuffer(videoUrl),
      fetchBuffer(audioUrl),
    ]);

    const muxed = await muxAudioVideo(vBuf, aBuf);

    // TEMP: data URL return (supabase upload would be better)
    const b64 = muxed.toString("base64");
    const dataUrl = `data:video/mp4;base64,${b64}`;

    const body = JSON.stringify({ muxedUrl: dataUrl });
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  } catch (err) {
    log("Mux error", err);
    const body = JSON.stringify({ error: err.message || String(err) });
    res.writeHead(500, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  // health
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }

  // accept POST on *both* "/" and "/mux" so we can't mismatch
  if (req.method === "POST" && (url.pathname === "/" || url.pathname === "/mux")) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const { videoUrl, audioUrl } = parsed;
        if (!videoUrl || !audioUrl) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Missing videoUrl or audioUrl" }));
        }
        handleMux(videoUrl, audioUrl, res);
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Bad JSON" }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  log(`Listening on port ${PORT}`);
});
