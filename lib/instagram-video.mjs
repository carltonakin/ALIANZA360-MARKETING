import { createFile } from "mp4box";

function normalizedArrayBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes.slice(0);
  if (ArrayBuffer.isView(bytes)) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  throw new Error("The uploaded video could not be read.");
}

export function inspectCampaignVideo(bytes) {
  return new Promise((resolve, reject) => {
    const file = createFile();
    let settled = false;
    file.onError = (message) => {
      if (settled) return;
      settled = true;
      reject(new Error(`The video container could not be parsed: ${String(message || "invalid MP4/MOV data")}.`));
    };
    file.onReady = (info) => {
      if (settled) return;
      settled = true;
      const tracks = Array.isArray(info.tracks) ? info.tracks : [];
      const video = tracks.find((track) => track.video);
      const audio = tracks.find((track) => track.audio);
      if (!video) {
        reject(new Error("The selected file does not contain a readable video track."));
        return;
      }
      const durationSeconds = Number(info.duration) / Number(info.timescale || 1);
      const videoDuration = Number(video.duration) / Number(video.timescale || 1);
      resolve({
        width: Number(video.video?.width || video.track_width || 0),
        height: Number(video.video?.height || video.track_height || 0),
        durationSeconds,
        frameRate: videoDuration > 0 ? Number(video.nb_samples || 0) / videoDuration : 0,
        videoCodec: String(video.codec || "").toLowerCase(),
        audioCodec: audio ? String(audio.codec || "").toLowerCase() : null,
        audioSampleRate: audio ? Number(audio.audio?.sample_rate || 0) : null,
        videoBitrate: Number(video.bitrate || 0),
        audioBitrate: audio ? Number(audio.bitrate || 0) : null,
        brands: Array.isArray(info.brands) ? info.brands.map((brand) => String(brand).trim()) : [],
      });
    };

    try {
      const data = normalizedArrayBuffer(bytes);
      data.fileStart = 0;
      file.appendBuffer(data);
      file.flush();
      if (!settled) {
        settled = true;
        reject(new Error("The video is missing the metadata required for Instagram validation."));
      }
    } catch (error) {
      if (settled) return;
      settled = true;
      reject(error);
    }
  });
}
