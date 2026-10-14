# Test stream for the mock API

A 6-second, 320x180, video-only VP9 stream in fragmented-MP4 HLS (about 40 KB). It is unprotected,
like the API's fake media provider, and uses VP9 because Playwright's Chromium has no H.264 decoder.
The mock API redirects authorized manifest URLs to `master.m3u8`.

Regenerate with:

```bash
ffmpeg -f lavfi -i "testsrc2=size=320x180:rate=24:duration=6" \
  -c:v libvpx-vp9 -b:v 30k -deadline realtime -cpu-used 8 -g 48 -keyint_min 48 -pix_fmt yuv420p \
  -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_fmp4_init_filename init.mp4 -hls_segment_filename "seg%d.m4s" media.m3u8
```

`master.m3u8` is written by hand so it can declare `CODECS`.
