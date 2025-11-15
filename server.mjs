import express from "express";
import fetch from "node-fetch";
import ffmpegPath from "ffmpeg-static";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { spawn } from "child_process";

const app = express();
app.use(express.json({ limit: "10mb" }));

function log(...xs) {
  console.log("[mux-service]", ...xs);
}

app.post("/mux", async (req, res) => {
  try {
    const { videoUrl, audioUrl } = req.body || {};
    if (!videoUrl || !audioUrl) {
      return res.status(400).json({ error: "Missing videoUrl or audioUrl" });
    }

    log("MUX request", { videoUrl, audioUrl });

    const id = randomUUID();
    const dir = tmpdir();
    const videoPath = join(dir, `${id}-video.mp4`);
    const audioPath = join(dir, `${id}-audio.mp3`);
    const outPath = join(dir, `${id}-out.mp4`);

    async function downloadToFile(url, destPath) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Download failed: ${url} (${r.status})`);
      const buf = Buffer.from(await r.arrayBuffer());
      await fs.writeFile(destPath, buf);
    }

    await downloadToFile(videoUrl, videoPath);
    await downloadToFile(audioUrl, audioPath);

    await new Promise((resolve, reject) => {
      const args = [
        "-i",
        videoPath,
        "-i",
        audioPath,
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-shortest",
        "-y",
        outPath,
      ];

      log("Running ffmpeg", ffmpegPath, args.join(" "));

      const proc = spawn(ffmpegPath, args);

      proc.stderr.on("data", d => log(String(d)));
      proc.on("error", reject);
      proc.on("close", code => {
        if (code === 0) resolve();
        else reject(new Error("ffmpeg exited with code " + code));
      });
    });

    const outBuf = await fs.readFile(outPath);

    // cleanup (best effort)
    fs.unlink(videoPath).catch(() => {});
    fs.unlink(audioPath).catch(() => {});
    fs.unlink(outPath).catch(() => {});

    res.setHeader("Content-Type", "video/mp4");
    res.send(outBuf);
  } catch (err) {
    log("MUX error", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log("Listening on port", PORT);
});
