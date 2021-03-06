import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";

import * as ffmpeg_static from "ffmpeg-static";
import * as ffprobe_static from "ffprobe-static";
import * as ffmpeg from "fluent-ffmpeg";

import * as Storage from "@google-cloud/storage";
const gcs = new Storage.Storage();

admin.initializeApp();

ffmpeg.setFfmpegPath(ffmpeg_static);
ffmpeg.setFfprobePath(ffprobe_static.path);

const runtimeOpts: functions.RuntimeOptions = {
  timeoutSeconds: 540,
  memory: "2GB",
};

export const videoCompressor = functions
  .region("asia-northeast1")
  .runWith(runtimeOpts)
  .storage.object()
  .onFinalize(async (object) => {
    const bucket = gcs.bucket(object.bucket);
    const filePath = object.name;
    if (!filePath) {
      console.error(`filePath not found`);
      return;
    }

    const fileName = filePath.split("/").pop();
    if (!fileName) {
      console.error(`fileName not found`);
      return;
    }

    const bucketDir = path.dirname(filePath);

    const workingDir = path.join(os.tmpdir(), "compressed");
    const tmpFilePath = path.join(workingDir, fileName);

    if (!object.contentType) {
      console.error(`fileName not found`);
      return;
    }

    const compressedIdentifier = "@compressed";

    if (
      fileName.includes(compressedIdentifier) ||
      !object.contentType.includes("video")
    ) {
      console.log("exiting function");
      return;
    }

    // 1. Ensure compressed dir exists
    await fs.ensureDir(workingDir);

    // 2. Download Source File
    await bucket.file(filePath).download({
      destination: tmpFilePath,
    });

    const ext = path.extname(fileName);
    const basename = path.basename(fileName, ext);
    const compressedName = `${basename}${compressedIdentifier}.mp4`;
    const compressedPath = path.join(workingDir, compressedName);

    // compress video
    const outputPath = await compress(tmpFilePath, compressedPath);

    // uplod to bucket
    bucket.upload(outputPath, {
      destination: path.join(bucketDir, compressedName),
    });

    return fs.remove(workingDir);
  });

// compress video by ffmpeg
function compress(input: string, output: string): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .format("mp4")
      .videoBitrate("1024k")
      .videoCodec("libx264")
      .size("640x?")
      .fps(30)
      .on("start", () => {
        console.log(`compress start`);
      })
      .on("end", () => {
        console.log(`compress finish`);
        resolve(output);
      })
      .on("error", (err: Error) => {
        console.log("An error occurred: " + err.message);
        reject(err);
      })
      .save(output);
  });
}
