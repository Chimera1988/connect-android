# Connect Native — PWA parity, phase 3A

## Included in this source-only change
- Per-message **Remove for me** action and multi-selection delete-for-me. Hidden message IDs are stored locally per signed-in user and conversation; server messages are untouched.
- Delivery acknowledgements (`last_delivered_at`) for incoming messages while chat is visible; read state uses the previously implemented `last_read_at` and notification dismissal.
- Outgoing checkmarks using the recipient's delivery and read timestamps, with accessibility labels.
- Typing indicator, using PWA-compatible `typing_until` in `conversation_user_state`.
- Existing reply/forward/edit/delete-for-everyone and media handling remain unchanged.

## Still outstanding
- Full chat list and conversation cleanup parity, visual search navigation, last-unread scroll positioning and date separators.
- Background notifications and native FCM must be tested on a device.
- Voice message audio waveform/speed, profile music mini-player, mini-game and remaining visual parity.

## Verification
- The GitHub Action installs packages and runs `npm run typecheck`; it commits the two source files only after success.
- No Expo prebuild, Gradle or APK creation.
- Runtime behavior remains unverified until the eventual final release validation on a device.
