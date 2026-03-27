Module.register("MMM-GestureControl", {
    defaults: {
        mqttServer: "127.0.0.1",
        mqttPort: 1883,
        mqttTopic: "magicmirror/gesture",
        haToken: "",
        haHost: "127.0.0.1",
        haPort: 8123,

        // Path to gesture_config.json on disk (null = disabled)
        gestureConfigPath: null,

        // Media player entity IDs for auto-detection
        mediaEntities: [],
        spotifyEntity: "",
        defaultRaumfeldEntity: "",

        // Auto-detect polling interval in ms
        autoDetectInterval: 60000,

        // Dial adjustment steps
        brightnessStep: 25,
        colorTempMin: 153,
        colorTempMax: 500,
        colorTempStep: 30,
        hueStep: 15,

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

        specialScenes: {
            GOTO_HOMEPAGE: "Homepage",
            GOTO_BILDERGALERIE: "Bildergalerie"
        },

        sceneToRoom: {},
        roomLights: {},

        // Entertainment Zone: ALL individual RGB lights across all rooms.
        // Used as fallback when no room with RGB lights is active.
        entertainmentZoneLights: [],

        debounceDelay: 300,
        debug: true
    },

    start: function() {
        Log.info("Starting module: " + this.name);
        this.lastGestureTime = 0;
        this.gestureCount = 0;
        this.currentScene = null;
        this.dialConnected = false;
        this.dialMode = "scenes";
        this.currentRoom = null;
        this.gestureConfig = null;  // Dynamic NEAR/FAR from dashboard

        this.sendSocketNotification("MQTT_CONNECT", {
            server: this.config.mqttServer,
            port: this.config.mqttPort,
            topic: this.config.mqttTopic,
            haToken: this.config.haToken,
            haHost: this.config.haHost,
            haPort: this.config.haPort,
            gestureConfigPath: this.config.gestureConfigPath,
            mediaEntities: this.config.mediaEntities,
            spotifyEntity: this.config.spotifyEntity,
            defaultRaumfeldEntity: this.config.defaultRaumfeldEntity,
            autoDetectInterval: this.config.autoDetectInterval,
            brightnessStep: this.config.brightnessStep,
            colorTempMin: this.config.colorTempMin,
            colorTempMax: this.config.colorTempMax,
            colorTempStep: this.config.colorTempStep,
            hueStep: this.config.hueStep
        });
    },

    getDom: function() {
        var wrapper = document.createElement("div");
        wrapper.className = "gesture-control-wrapper";

        if (this.config.debug && this.lastGesture) {
            var debugDiv = document.createElement("div");
            debugDiv.className = "gesture-debug";

            var actionIcons = {
                SCENES_NEXT: "fa-forward-step",
                SCENES_PREV: "fa-backward-step",
                SCENES_PAUSE: "fa-pause",
                SCENES_RESUME: "fa-play",
                COLOR_SCAN: "fa-palette",
                GOTO_HOMEPAGE: "fa-house",
                GOTO_BILDERGALERIE: "fa-images",
                NOTHING: "fa-ban",
                MEDIA_TOGGLE: "fa-circle-play",
                MEDIA_NEXT: "fa-angles-right",
                MEDIA_PREV: "fa-angles-left",
                SPOTIFY_TOGGLE: "fa-music",
                SPOTIFY_NEXT: "fa-forward",
                SPOTIFY_PREV: "fa-backward",
                SNOW_TOGGLE: "fa-snowflake",
                DISPLAY_TOGGLE: "fa-display",
                LIGHTS_TOGGLE: "fa-lightbulb"
            };
            var action = this.config.gestures[this.lastGesture] || this.lastGesture;
            var iconEl = document.createElement("i");
            iconEl.className = "fas " + (actionIcons[action] || "fa-question");
            iconEl.style.fontSize = "1.5em";
            debugDiv.appendChild(iconEl);

            wrapper.appendChild(debugDiv);
        }

        return wrapper;
    },

    getStyles: function() {
        return ["MMM-GestureControl.css"];
    },

    notificationReceived: function(notification, payload) {
        if (notification === "GESTURE_CONFIG") {
            this.gestureConfig = payload;
            var gMap = {left_action:"LEFT",right_action:"RIGHT",up_action:"UP",down_action:"DOWN",near_action:"NEAR",far_action:"FAR",touch_1_action:"TOUCH_1",touch_2_action:"TOUCH_2",touch_3_action:"TOUCH_3",touch_4_action:"TOUCH_4",touch_single_action:"TOUCH_SINGLE"};
            for (var k in gMap) { if (payload[k]) this.config.gestures[gMap[k]] = payload[k]; }
            Log.info("MMM-GestureControl: Config applied L=" + this.config.gestures.LEFT + " R=" + this.config.gestures.RIGHT + " U=" + this.config.gestures.UP + " D=" + this.config.gestures.DOWN + " N=" + this.config.gestures.NEAR + " F=" + this.config.gestures.FAR);
            this.gestureConfig = payload;
            if (payload.near_action) this.config.gestures.NEAR = payload.near_action;
            if (payload.far_action) this.config.gestures.FAR = payload.far_action;
            Log.info("MMM-GestureControl: Gesture config updated NEAR=" + payload.near_action + " FAR=" + payload.far_action);
        }
        if (notification === "DIAL_CONNECTED") {
            this.dialConnected = payload.connected;
            this.dialMode = payload.mode || this.dialMode;
            Log.info("MMM-GestureControl: Dial " + (this.dialConnected ? "ON" : "OFF") + " mode=" + this.dialMode);
        }
        if (notification === "DIAL_MODE") {
            this.dialMode = payload.mode;
            Log.info("MMM-GestureControl: Dial mode -> " + this.dialMode);
        }
        if (notification === "DIAL_ROTATE") {
            this.handleDialRotate(payload);
            return;
        }
        if (notification === "SCENES_CHANGED") {
            var self = this;
            var setRoom = function(p) {
                var name = null;
                if (p && p.currentScene && p.currentScene.name) name = p.currentScene.name;
                else if (typeof p === "string") name = p;
                self.currentScene = name;
                var room = self.config.sceneToRoom[name];
                self.currentRoom = room || null;
                if (room) Log.info("MMM-GestureControl: Room = " + room);
            };
            if (payload && typeof payload.then === "function") {
                payload.then(setRoom);
            } else {
                setRoom(payload);
            }
        }
    },

    socketNotificationReceived: function(notification, payload) {
        if (notification === "GESTURE_CONFIG") {
            this.gestureConfig = payload;
            var gMap = {left_action:"LEFT",right_action:"RIGHT",up_action:"UP",down_action:"DOWN",near_action:"NEAR",far_action:"FAR",touch_1_action:"TOUCH_1",touch_2_action:"TOUCH_2",touch_3_action:"TOUCH_3",touch_4_action:"TOUCH_4",touch_single_action:"TOUCH_SINGLE"};
            for (var k in gMap) { if (payload[k]) this.config.gestures[gMap[k]] = payload[k]; }
            Log.info("MMM-GestureControl: Config applied L=" + this.config.gestures.LEFT + " R=" + this.config.gestures.RIGHT + " U=" + this.config.gestures.UP + " D=" + this.config.gestures.DOWN + " N=" + this.config.gestures.NEAR + " F=" + this.config.gestures.FAR);
            this.sendNotification("GESTURE_CONFIG", payload);
        } else if (notification === "MQTT_GESTURE") {
            this.handleGesture(payload);
        } else if (notification === "MQTT_CONNECTED") {
            Log.info("MMM-GestureControl: MQTT connected");
        }
    },

    handleGesture: function(gestureData) {
        var now = Date.now();
        var gesture = gestureData.gesture;

        if (now - this.lastGestureTime < this.config.debounceDelay) {
            return;
        }

        this.lastGestureTime = now;
        this.gestureCount++;

        var action = this.config.gestures[gesture];
        Log.info("MMM-GestureControl: " + gesture + " -> " + action);

        if (action === "COLOR_SCAN") {
            this.lastGesture = "COLOR_SCAN";
            this.handleColorScan(gestureData);
        } else if (action) {
            this.lastGesture = gesture;
            this.executeAction(action);
        }

        if (this.config.debug) {
            this.updateDom(300);
            var self = this;
            setTimeout(function() {
                self.lastGesture = null;
                self.updateDom(300);
            }, 2000);
        }
    },

    handleColorScan: function(gestureData) {
        if (!gestureData.color) {
            Log.warn("MMM-GestureControl: NEAR without color data");
            return;
        }

        var lights = null;
        var target = "entertainment zone";

        // If a room with RGB lights is active, use that room's lights
        if (this.currentRoom) {
            var roomLights = this.config.roomLights[this.currentRoom];
            if (roomLights && roomLights.length > 0) {
                lights = roomLights;
                target = this.currentRoom;
            }
        }

        // Fallback: use entertainment zone (all individual RGB lights)
        if (!lights) {
            lights = this.config.entertainmentZoneLights;
        }

        if (!lights || lights.length === 0) {
            Log.warn("MMM-GestureControl: No RGB lights available (no room, no zone)");
            return;
        }

        var c = gestureData.color;
        Log.info("MMM-GestureControl: Color R=" + c.r + " G=" + c.g + " B=" + c.b + " -> " + target + " (" + lights.length + " lights)");

        this.sendSocketNotification("SET_LIGHT_COLOR", {
            lights: lights,
            color: [c.r, c.g, c.b],
            token: this.config.haToken
        });
    },

    handleDialRotate: function(data) {
        var dir = data.direction === "next" ? 1 : -1;
        var mode = data.mode;
        Log.info("MMM-GestureControl: Dial rotate " + data.direction + " mode=" + mode);

        // Get target lights
        var lights = null;
        if (this.currentRoom) {
            lights = this.config.roomLights[this.currentRoom];
        }
        if (!lights || lights.length === 0) {
            lights = this.config.entertainmentZoneLights;
        }
        if (!lights || lights.length === 0) return;

        if (mode === "brightness") {
            this.sendSocketNotification("DIAL_ADJUST", {
                type: "brightness", direction: dir, lights: lights,
                token: this.config.haToken
            });
        } else if (mode === "color_temp") {
            this.sendSocketNotification("DIAL_ADJUST", {
                type: "color_temp", direction: dir, lights: lights,
                token: this.config.haToken
            });
        } else if (mode === "hue") {
            this.sendSocketNotification("DIAL_ADJUST", {
                type: "hue", direction: dir, lights: lights,
                token: this.config.haToken
            });
        } else if (mode === "volume") {
            this.sendSocketNotification("DIAL_ADJUST", {
                type: "volume", direction: dir,
                token: this.config.haToken
            });
        }
    },

    executeAction: function(action) {
        switch(action) {
            case "NOTHING": break;
            case "SCENES_NEXT": this.sendNotification("SCENES_NEXT"); break;
            case "SCENES_PREV": this.sendNotification("SCENES_PREV"); break;
            case "SCENES_PAUSE": this.sendNotification("SCENES_PAUSE"); break;
            case "SCENES_RESUME": this.sendNotification("SCENES_RESUME"); break;
            case "MEDIA_TOGGLE":
            case "SPOTIFY_TOGGLE":
                this.sendSocketNotification("MEDIA_CONTROL", {action: "media_play_pause", token: this.config.haToken, media_target: (this.gestureConfig && this.gestureConfig.media_target) || "auto"});
                break;
            case "MEDIA_NEXT":
            case "SPOTIFY_NEXT":
                this.sendSocketNotification("MEDIA_CONTROL", {action: "media_next_track", token: this.config.haToken, media_target: (this.gestureConfig && this.gestureConfig.media_target) || "auto"});
                break;
            case "MEDIA_PREV":
            case "SPOTIFY_PREV":
                this.sendSocketNotification("MEDIA_CONTROL", {action: "media_previous_track", token: this.config.haToken, media_target: (this.gestureConfig && this.gestureConfig.media_target) || "auto"});
                break;
            case "SNOW_TOGGLE": this.sendNotification("SNOW_TOGGLE"); break;
            case "DISPLAY_TOGGLE":
                this.sendSocketNotification("DISPLAY_TOGGLE");
                break;
            case "LIGHTS_TOGGLE":
                var lights = null;
                if (this.currentRoom) lights = this.config.roomLights[this.currentRoom];
                if (!lights || lights.length === 0) lights = this.config.entertainmentZoneLights;
                if (lights && lights.length > 0) {
                    this.sendSocketNotification("LIGHTS_TOGGLE", {
                        lights: lights, token: this.config.haToken
                    });
                }
                break;
            default:
                if (action.startsWith("GOTO_")) {
                    var sceneName = this.config.specialScenes[action];
                    if (sceneName) { this.sendNotification("SCENES_PLAY", { scene: sceneName }); }
                }
                break;
        }
    }
});