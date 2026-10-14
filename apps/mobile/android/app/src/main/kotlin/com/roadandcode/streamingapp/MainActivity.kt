package com.roadandcode.streamingapp

import android.os.Bundle
import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Premium video must not be captured: FLAG_SECURE blocks screenshots,
        // screen recording, casting of the app window and the recents thumbnail.
        // Set before the Flutter view is attached so no frame is ever exposed.
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE,
        )
        super.onCreate(savedInstanceState)
    }

    // TODO(drm): override configureFlutterEngine and register the
    // "com.roadandcode.streamingapp/drm_player" MethodChannel backed by Media3
    // ExoPlayer with Widevine (see lib/features/player/native_drm_player.dart).
}
