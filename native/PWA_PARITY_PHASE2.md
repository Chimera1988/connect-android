# Connect Native — PWA parity phase 2

This source-only integration introduces the PWA settings hierarchy and applies native appearance preferences across the Android client. No WebView or APK is added.

## Implemented in source in this phase

- Settings menu with distinct Appearance, Stickers, Notifications, Data and storage, Privacy, About pages, profile access, admin invitation access, and log out.
- Appearance saved on the device: dark/light mode, seven PWA visual scene labels, seven PWA accent swatches, custom hexadecimal accent entry, local chat wallpaper, reset.
- PWA-aligned built-in sticker pack visibility; custom sticker pack creation, image upload, deletion and public/private selection.
- Notification preference controls (enabled, vibration, standard signal) persisted via `notification_preferences`; existing device sound chooser retained.
- Own profile editing for name and bio, cropped avatar photo upload; original profile media remains available.
- Account deletion through the existing PWA API with password and confirmation.
- PWA about/version details shown distinctly from the unfinished Android build.

## NOT complete (do not release an APK)

- Exact pixel-level PWA Liquid Glass recreation, high-fidelity distinct animated scene artwork, and full gallery layout.
- Functional JSON file export and native system share sheet.
- Reliable FCM message delivery/Android app registration and real-device permission checks.
- Native music playback queue, mini-player, now-playing visibility, and resuming position.
- PWA game "Если скучно" and some fine-grained message gestures/reading indicators.
- All 199 audit points, final compiled Android verification, and on-device acceptance tests.

To run CI: this integration workflow performs TypeScript checks and commits the source changes only after passing. No Gradle task or APK packaging step.
