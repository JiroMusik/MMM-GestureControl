# MMM-GestureControl

A [MagicMirror](https://magicmirror.builders/) module that enables gesture-based control using an APDS-9960 sensor via MQTT. Integrates with Home Assistant for smart home control including lights, media playback, and scenes.

## Features

- Gesture recognition (left, right, up, down, near, far, touch)
- Color scanning with APDS-9960 to set RGB light colors
- Media control (Spotify, Raumfeld/DLNA speakers) with auto-detection
- Rotary dial support for brightness, color temperature, hue, and volume
- Radio favorites cycling via Home Assistant media browser
- Scene navigation via MagicMirror notifications
- Configurable gesture-to-action mappings
- Debug overlay with gesture icons

## Requirements

- [MagicMirror](https://magicmirror.builders/) v2.15+
- APDS-9960 gesture sensor connected to an MQTT broker
- MQTT broker (e.g., Mosquitto)
- [Home Assistant](https://www.home-assistant.io/) (for light/media control features)
- Home Assistant long-lived access token

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/jiromusik/MMM-GestureControl.git
cd MMM-GestureControl
npm install
```

## Configuration

Add the module to your `config/config.js`:

```js
{
    module: "MMM-GestureControl",
    position: "bottom_right",
    config: {
        mqttServer: "127.0.0.1",
        mqttPort: 1883,
        mqttTopic: "magicmirror/gesture",
        haToken: "YOUR_HOME_ASSISTANT_LONG_LIVED_TOKEN",
        haHost: "127.0.0.1",
        haPort: 8123,

        // Media entities for auto-detection (all your HA media_player entity IDs)
        mediaEntities: [
            "media_player.spotify_username",
            "media_player.living_room_speaker"
        ],
        spotifyEntity: "media_player.spotify_username",
        defaultRaumfeldEntity: "media_player.living_room_speaker",

        // Gesture-to-action mappings
        gestures: {
            LEFT: "SCENES_NEXT",
            RIGHT: "SCENES_PREV",
            UP: "SCENES_RESUME",
            DOWN: "SCENES_PAUSE",
            FAR: "GOTO_HOMEPAGE",
            NEAR: "COLOR_SCAN",
            TOUCH_1: "NOTHING",
            TOUCH_2: "NOTHING",
            TOUCH_3: "NOTHING",
            TOUCH_4: "NOTHING",
            TOUCH_SINGLE: "NOTHING"
        },

        // Scene-to-room mapping (for room-aware light control)
        sceneToRoom: {
            "Living Room": "living_room",
            "Bedroom": "bedroom"
        },

        // Room light entity IDs (RGB lights per room)
        roomLights: {
            "living_room": ["light.living_room_rgb_1", "light.living_room_rgb_2"],
            "bedroom": ["light.bedroom_rgb"]
        },

        // Fallback: all RGB lights when no room is active
        entertainmentZoneLights: [
            "light.living_room_rgb_1",
            "light.living_room_rgb_2",
            "light.bedroom_rgb"
        ],

        debug: false
    }
}
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mqttServer` | String | `"127.0.0.1"` | MQTT broker hostname |
| `mqttPort` | Number | `1883` | MQTT broker port |
| `mqttTopic` | String | `"magicmirror/gesture"` | MQTT topic for gesture events |
| `haToken` | String | `""` | Home Assistant long-lived access token |
| `haHost` | String | `"127.0.0.1"` | Home Assistant hostname |
| `haPort` | Number | `8123` | Home Assistant port |
| `gestureConfigPath` | String | `null` | Path to gesture_config.json on disk (null to disable) |
| `mediaEntities` | Array | `[]` | HA media player entity IDs for auto-detection |
| `spotifyEntity` | String | `""` | Spotify media_player entity ID |
| `defaultRaumfeldEntity` | String | `""` | Fallback Raumfeld/DLNA entity ID |
| `autoDetectInterval` | Number | `60000` | Media auto-detect polling interval (ms) |
| `brightnessStep` | Number | `25` | Brightness dial step (1-255) |
| `colorTempMin` | Number | `153` | Minimum color temperature (mireds) |
| `colorTempMax` | Number | `500` | Maximum color temperature (mireds) |
| `colorTempStep` | Number | `30` | Color temperature dial step |
| `hueStep` | Number | `15` | Hue dial step (degrees) |
| `gestures` | Object | See above | Gesture-to-action mappings |
| `specialScenes` | Object | `{}` | Action-to-scene name mappings for GOTO_ actions |
| `sceneToRoom` | Object | `{}` | Scene name to room key mapping |
| `roomLights` | Object | `{}` | Room key to array of light entity IDs |
| `entertainmentZoneLights` | Array | `[]` | Fallback RGB light entity IDs |
| `debounceDelay` | Number | `300` | Gesture debounce delay (ms) |
| `debug` | Boolean | `true` | Show gesture debug overlay |

## Available Actions

| Action | Description |
|--------|-------------|
| `NOTHING` | No action |
| `SCENES_NEXT` | Navigate to next scene |
| `SCENES_PREV` | Navigate to previous scene |
| `SCENES_PAUSE` | Pause scene rotation |
| `SCENES_RESUME` | Resume scene rotation |
| `COLOR_SCAN` | Set RGB lights to scanned color |
| `GOTO_HOMEPAGE` | Jump to homepage scene |
| `GOTO_BILDERGALERIE` | Jump to gallery scene |
| `MEDIA_TOGGLE` | Play/pause media (auto-detected target) |
| `MEDIA_NEXT` | Next track (auto-detected target) |
| `MEDIA_PREV` | Previous track (auto-detected target) |
| `SPOTIFY_TOGGLE` | Play/pause Spotify |
| `SPOTIFY_NEXT` | Next Spotify track |
| `SPOTIFY_PREV` | Previous Spotify track |
| `SNOW_TOGGLE` | Toggle snow effect |
| `DISPLAY_TOGGLE` | Toggle display on/off |
| `LIGHTS_TOGGLE` | Toggle room lights |

## MQTT Payload Format

The module expects JSON payloads on the configured MQTT topic:

```json
{
    "gesture": "LEFT",
    "color": { "r": 255, "g": 128, "b": 0 }
}
```

The `color` field is only required for `NEAR` gestures when using `COLOR_SCAN`.

## Notifications

### Sent Notifications
- `SCENES_NEXT` / `SCENES_PREV` / `SCENES_PAUSE` / `SCENES_RESUME` / `SCENES_PLAY`
- `GESTURE_CONFIG` - Broadcasts updated gesture configuration
- `SNOW_TOGGLE`

### Received Notifications
- `GESTURE_CONFIG` - Updates gesture mappings dynamically
- `DIAL_CONNECTED` - Rotary dial connection status
- `DIAL_MODE` - Change dial mode (brightness, color_temp, hue, volume)
- `DIAL_ROTATE` - Dial rotation event
- `SCENES_CHANGED` - Current scene changed (for room-aware light control)

## Home Assistant Setup

1. Create a [long-lived access token](https://www.home-assistant.io/docs/authentication/) in your HA profile
2. Add the token to `haToken` in the module config
3. List your media player entity IDs in `mediaEntities`
4. List your RGB light entity IDs in `roomLights` and/or `entertainmentZoneLights`

## License

MIT
