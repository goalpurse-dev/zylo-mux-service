// server.mjs
import http from "http";
import { URL } from "url";
import ffmpeg from "fluent-ffmpeg";
import fetch from "node-fetch";
import { promises as fs } from "fs";
import { randomBytes } from "crypto";

const PORT = process.env.PORT || 3000;

function log(...args) {
  console.log("[mux-service]", ...args);
}

// -------------------------
// Download helper → Buffer
// -------------------------
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

// -------------------------
// ffmpeg mux using temp files
// -------------------------
async function muxAudioVideo(videoBuf, audioBuf) {
  // unique id for temp files
  const id = randomBytes(8).toString("hex");
  const tmpVideo = `/tmp/video-${id}.mp4`;
  const tmpAudio = `/tmp/audio-${id}.mp3`;
  const tmpOut   = `/tmp/out-${id}.mp4`;

  // write inputs to disk
  await fs.writeFile(tmpVideo, videoBuf);
  await fs.writeFile(tmpAudio, audioBuf);

  // run ffmpeg: copy video stream, re-encode audio, stop at shortest
  await new Promise((resolve, reject) => {
    ffmpeg(tmpVideo)
      .input(tmpAudio)
      .outputOptions(["-c:v copy", "-c:a aac", "-shortest"])
      .save(tmpOut)
      .on("end", resolve)
      .on("error", reject);
  });

  // read output back to memory
  const outBuf = await fs.readFile(tmpOut);

  // best-effort cleanup (non-blocking)
  fs.unlink(tmpVideo).catch(() => {});
  fs.unlink(tmpAudio).catch(() => {});
  fs.unlink(tmpOut).catch(() => {});

  return outBuf;
}

// -------------------------
// HTTP handler for /mux
// -------------------------
async function handleMux(videoUrl, audioUrl, res) {
  try {
    log("Start mux", { videoUrl, audioUrl });

    const [vBuf, aBuf] = await Promise.all([
      fetchBuffer(videoUrl),
      fetchBuffer(audioUrl),
    ]);

    const muxed = await muxAudioVideo(vBuf, aBuf);

    // TEMP: data URL return (later you can upload to Supabase instead)
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

// -------------------------
// HTTP server
// -------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  // health check
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }

  // accept POST on *both* "/" and "/mux"
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
