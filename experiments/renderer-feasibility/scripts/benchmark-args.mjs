export function parseBenchmarkArgs(argumentsList) {
  const modeArg = argumentsList.find(argument => argument.startsWith('--mode='));
  const mode = modeArg?.slice('--mode='.length) ?? 'swiftshader';
  if (!['swiftshader', 'gpu'].includes(mode)) throw new Error(`Unsupported renderer mode: ${mode}`);
  const skipFfmpeg = argumentsList.includes('--skip-ffmpeg');
  const externalFfmpegMsArg = argumentsList.find(argument => argument.startsWith('--ffmpeg-ms='));
  const externalFfmpegMs = externalFfmpegMsArg === undefined
    ? null
    : Number(externalFfmpegMsArg.slice('--ffmpeg-ms='.length));
  if (externalFfmpegMs !== null && !skipFfmpeg) {
    throw new Error('--ffmpeg-ms requires --skip-ffmpeg to avoid measuring and overriding FFmpeg twice');
  }
  if (externalFfmpegMs !== null && (!Number.isFinite(externalFfmpegMs) || externalFfmpegMs < 0)) {
    throw new Error(`Invalid --ffmpeg-ms value: ${externalFfmpegMsArg}`);
  }
  return {mode, skipFfmpeg, externalFfmpegMs};
}
