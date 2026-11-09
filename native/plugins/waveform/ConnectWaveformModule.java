package com.connect.waveform;

import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import android.os.SystemClock;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Streaming PCM peak envelope: only per-bucket peaks and codec buffers are retained. */
public final class ConnectWaveformModule extends ReactContextBaseJavaModule {
  private static final long MAX_DURATION_US = 30L * 60L * 1_000_000L;
  private static final long DECODE_TIMEOUT_MS = 45_000L;
  private final ThreadPoolExecutor worker = new ThreadPoolExecutor(
      1, 1, 10L, TimeUnit.SECONDS, new ArrayBlockingQueue<>(4));

  ConnectWaveformModule(ReactApplicationContext context) {
    super(context);
    worker.allowCoreThreadTimeOut(true);
  }

  @Override public String getName() { return "ConnectWaveform"; }

  @ReactMethod public void decode(String localUri, double requestedCount, Promise promise) {
    final int count = Math.max(1, Math.min(128, (int) requestedCount));
    try {
      worker.execute(() -> {
        try { promise.resolve(decodeFile(localUri, count)); }
        catch (Exception error) { promise.reject("E_WAVEFORM_DECODE", error.getMessage(), error); }
      });
    } catch (RejectedExecutionException error) {
      promise.reject("E_WAVEFORM_BUSY", "Audio decoder queue is full", error);
    }
  }

  private WritableArray decodeFile(String localUri, int count) throws Exception {
    Uri uri = Uri.parse(localUri);
    if (!"file".equals(uri.getScheme()) && !"content".equals(uri.getScheme())) {
      throw new IllegalArgumentException("Audio decoder requires a local file or content URI");
    }
    MediaExtractor extractor = new MediaExtractor();
    MediaCodec codec = null;
    boolean started = false;
    try {
      extractor.setDataSource(getReactApplicationContext(), uri, null);
      MediaFormat inputFormat = null;
      String mime = null;
      for (int index = 0; index < extractor.getTrackCount(); index++) {
        MediaFormat track = extractor.getTrackFormat(index);
        String candidate = track.getString(MediaFormat.KEY_MIME);
        if (candidate != null && candidate.startsWith("audio/")) {
          inputFormat = track;
          mime = candidate;
          extractor.selectTrack(index);
          break;
        }
      }
      if (inputFormat == null || mime == null) throw new IllegalArgumentException("No audio track");
      if (!inputFormat.containsKey(MediaFormat.KEY_DURATION)) throw new IllegalArgumentException("Audio duration unavailable");
      long durationUs = inputFormat.getLong(MediaFormat.KEY_DURATION);
      if (durationUs <= 0 || durationUs > MAX_DURATION_US) throw new IllegalArgumentException("Audio duration exceeds 30 minutes");
      int sampleRate = inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE);
      int channelCount = inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
      int encoding = inputFormat.containsKey(MediaFormat.KEY_PCM_ENCODING)
          ? inputFormat.getInteger(MediaFormat.KEY_PCM_ENCODING) : AudioFormat.ENCODING_PCM_16BIT;
      double[] totals = new double[count];
      long[] samples = new long[count];
      long deadline = SystemClock.elapsedRealtime() + DECODE_TIMEOUT_MS;

      // Android PCM WAV tracks may be supplied directly, without a codec.
      if ("audio/raw".equals(mime)) {
        int capacity = inputFormat.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)
            ? inputFormat.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE) : 262144;
        if (capacity <= 0 || capacity > 4 * 1024 * 1024) throw new IllegalArgumentException("PCM frame is too large");
        ByteBuffer data = ByteBuffer.allocateDirect(capacity).order(ByteOrder.LITTLE_ENDIAN);
        while (true) {
          checkDeadline(deadline);
          data.clear();
          long timestamp = extractor.getSampleTime();
          int bytes = extractor.readSampleData(data, 0);
          if (bytes < 0) break;
          data.position(0); data.limit(bytes);
          collect(data, bytes, timestamp, durationUs, sampleRate, channelCount, encoding, totals, samples);
          extractor.advance();
        }
      } else {
        codec = MediaCodec.createDecoderByType(mime);
        codec.configure(inputFormat, null, null, 0);
        codec.start();
        started = true;
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        boolean inputEnded = false;
        boolean outputEnded = false;
        while (!outputEnded) {
          checkDeadline(deadline);
          if (!inputEnded) {
            int inputIndex = codec.dequeueInputBuffer(10000);
            if (inputIndex >= 0) {
              ByteBuffer input = codec.getInputBuffer(inputIndex);
              if (input == null) throw new IllegalStateException("Missing audio input buffer");
              input.clear();
              int bytes = extractor.readSampleData(input, 0);
              if (bytes < 0) {
                codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                inputEnded = true;
              } else {
                codec.queueInputBuffer(inputIndex, 0, bytes, Math.max(0, extractor.getSampleTime()), 0);
                extractor.advance();
              }
            }
          }
          int outputIndex = codec.dequeueOutputBuffer(info, 10000);
          if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
            MediaFormat output = codec.getOutputFormat();
            sampleRate = output.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            channelCount = output.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            encoding = output.containsKey(MediaFormat.KEY_PCM_ENCODING)
                ? output.getInteger(MediaFormat.KEY_PCM_ENCODING) : AudioFormat.ENCODING_PCM_16BIT;
          } else if (outputIndex >= 0) {
            try {
              ByteBuffer output = codec.getOutputBuffer(outputIndex);
              if (output != null && info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                output.position(info.offset); output.limit(info.offset + info.size);
                collect(output.slice().order(ByteOrder.LITTLE_ENDIAN), info.size, info.presentationTimeUs,
                    durationUs, sampleRate, channelCount, encoding, totals, samples);
              }
              outputEnded = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
            } finally { codec.releaseOutputBuffer(outputIndex, false); }
          }
        }
      }
      long totalSamples = 0;
      double max = 0.001;
      for (int index = 0; index < count; index++) {
        totalSamples += samples[index];
        max = Math.max(max, totals[index]);
      }
      if (totalSamples == 0) throw new IllegalArgumentException("Audio contains no decoded samples");
      WritableArray bars = Arguments.createArray();
      for (double total : totals) bars.pushDouble(Math.max(0.14, Math.min(1.0, Math.pow(total / max, 0.72))));
      return bars;
    } finally {
      if (codec != null) {
        try { if (started) codec.stop(); } catch (Exception ignored) { }
        try { codec.release(); } catch (Exception ignored) { }
      }
      extractor.release();
    }
  }

  private static void checkDeadline(long deadline) {
    if (Thread.currentThread().isInterrupted() || SystemClock.elapsedRealtime() > deadline) {
      throw new IllegalStateException("Audio waveform decoding timed out");
    }
  }

  private static void collect(ByteBuffer pcm, int size, long timestamp, long durationUs,
      int sampleRate, int channels, int encoding, double[] totals, long[] samples) {
    if (sampleRate <= 0 || channels <= 0 || channels > 32) throw new IllegalArgumentException("Invalid PCM format");
    int bytesPerSample;
    switch (encoding) {
      case AudioFormat.ENCODING_PCM_8BIT: bytesPerSample = 1; break;
      case AudioFormat.ENCODING_PCM_16BIT: bytesPerSample = 2; break;
      case AudioFormat.ENCODING_PCM_FLOAT: bytesPerSample = 4; break;
      case 21: bytesPerSample = 3; break; // ENCODING_PCM_24BIT_PACKED (API 31)
      case 22: bytesPerSample = 4; break; // ENCODING_PCM_32BIT (API 31)
      default: throw new IllegalArgumentException("Unsupported PCM encoding: " + encoding);
    }
    int frameSize = bytesPerSample * channels;
    int frames = size / frameSize;
    // As in the PWA, use the first channel, after decoding every frame.
    for (int frame = 0; frame < frames; frame++) {
      pcm.position(frame * frameSize);
      double value;
      switch (encoding) {
        case AudioFormat.ENCODING_PCM_8BIT: value = ((pcm.get() & 255) - 128) / 128.0; break;
        case AudioFormat.ENCODING_PCM_16BIT: value = pcm.getShort() / 32768.0; break;
        case AudioFormat.ENCODING_PCM_FLOAT: value = pcm.getFloat(); break;
        case 21:
          int raw = (pcm.get() & 255) | ((pcm.get() & 255) << 8) | (pcm.get() << 16);
          value = raw / 8388608.0;
          break;
        default: value = pcm.getInt() / 2147483648.0;
      }
      if (!Double.isFinite(value)) continue;
      long time = Math.max(0, timestamp) + frame * 1_000_000L / sampleRate;
      int bucket = (int) Math.min(totals.length - 1, time * totals.length / durationUs);
      totals[bucket] = Math.max(totals[bucket], Math.min(1.0, Math.abs(value)));
      samples[bucket]++;
    }
  }

  @Override public void invalidate() {
    // React host teardown: stop active decoding and discard pending work.
    worker.shutdownNow();
    super.invalidate();
  }
}
