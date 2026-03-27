const NodeHelper = require("node_helper");
const fs = require("fs");
const mqtt = require("mqtt");
const http = require("http");
const WebSocket = require("ws");

module.exports = NodeHelper.create({
    start: function() {
        console.log("Starting node_helper for: " + this.name);
        this.mqttClient = null;
        this.config = null;
        this.autoMediaTarget = "spotify";  // detected target
        this.raumfeldEntity = null;  // auto-detected playing raumfeld entity
        this.raumfeldContentType = "unknown";
        this.raumfeldMediaTitle = null;
        this.raumfeldMediaAlbum = null;
        this.raumfeldMediaArtist = null;
        this.radioFavorites = null;
        this.radioFavIndex = -1;
        this.haToken = null;
    },

    socketNotificationReceived: function(notification, payload) {
        if (notification === "MQTT_CONNECT") {
            this.config = payload;
            this.connectMQTT();
        } else if (notification === "DIAL_ADJUST") {
            this.handleDialAdjust(payload);
        } else if (notification === "DISPLAY_TOGGLE") {
            this.toggleDisplay();
        } else if (notification === "LIGHTS_TOGGLE") {
            this.toggleLights(payload);
        } else if (notification === "SET_LIGHT_COLOR") {
            this.setLightColor(payload);
        } else if (notification === "SPOTIFY_CONTROL") {
            this.mediaControl(payload);
        } else if (notification === "MEDIA_CONTROL") {
            this.mediaControl(payload);
        }
    },

    connectMQTT: function() {
        var self = this;
        var mqttUrl = "mqtt://" + this.config.server + ":" + this.config.port;
        console.log("MMM-GestureControl: Connecting to MQTT at " + mqttUrl);

        this.mqttClient = mqtt.connect(mqttUrl, {
            clientId: "magicmirror_gesture_" + Math.random().toString(16).substr(2, 8),
        });

        this.mqttClient.on("connect", function() {
            console.log("MMM-GestureControl: MQTT connected");
            self.sendSocketNotification("MQTT_CONNECTED", true);
            self.mqttClient.subscribe(self.config.topic);
            self.mqttClient.subscribe("mm/gesture/config");

            // Start auto media detection on startup if token available
            if (self.config.haToken) {
                self.startAutoDetect(self.config.haToken);
            }

            // Load saved config on startup
            var configPath = self.config.gestureConfigPath;
            if (configPath) {
                try {
                    var raw = fs.readFileSync(configPath, "utf8");
                    var cfg = JSON.parse(raw);
                    console.log("MMM-GestureControl: Loaded config from file: " + JSON.stringify(cfg));
                    self.sendSocketNotification("GESTURE_CONFIG", cfg);
                } catch(e) {
                    console.log("MMM-GestureControl: No saved config found, using defaults");
                }
            }
        });

        this.mqttClient.on("message", function(topic, message) {
            if (topic === "mm/gesture/config") {
                try {
                    var cfg = JSON.parse(message.toString());
                    console.log("MMM-GestureControl: Gesture config received NEAR=" + cfg.near_action + " FAR=" + cfg.far_action);
                    self.sendSocketNotification("GESTURE_CONFIG", cfg);
                } catch(e) {}
                return;
            }
            try {
                var payload = JSON.parse(message.toString());
                console.log("MMM-GestureControl: Gesture " + payload.gesture);
                self.sendSocketNotification("MQTT_GESTURE", payload);
            } catch(e) {
                console.error("MMM-GestureControl: Parse error - " + e);
            }
        });

        this.mqttClient.on("error", function(error) {
            console.error("MMM-GestureControl: MQTT error - " + error);
        });
    },

    setLightColor: function(payload) {
        var lights = payload.lights;
        var color = payload.color;
        var token = payload.token;
        console.log("MMM-GestureControl: Setting RGB [" + color + "] on " + lights.length + " lights");

        for (var i = 0; i < lights.length; i++) {
            this.callHA(token, lights[i], color);
        }
    },

    startAutoDetect: function(token) {
        if (this._autoInterval || !token) return;
        this.haToken = token;
        var self = this;
        this.detectActiveMedia();
        this._autoInterval = setInterval(function() { self.detectActiveMedia(); }, self.config.autoDetectInterval);
        this.loadRadioFavorites(token);
        console.log("MMM-GestureControl: Auto media detect started (60s)");
    },

    loadRadioFavorites: function(token) {
        if (this.radioFavorites) return; // already loaded
        var self = this;
        console.log("MMM-GestureControl: Loading radio favorites...");
        try {
        var ws = new WebSocket("ws://" + self.config.haHost + ":" + self.config.haPort + "/api/websocket");
        this._favoritesWs = ws;
        ws.on("open", function() { console.log("MMM-GestureControl: Favorites WS open"); });
        ws.on("message", function(data) {
            var msg = JSON.parse(data.toString());
            if (msg.type === "auth_required") {
                ws.send(JSON.stringify({type: "auth", access_token: token}));
            } else if (msg.type === "auth_ok") {
                console.log("MMM-GestureControl: Favorites WS auth OK");
                var browseEntity = self.raumfeldEntity || self.config.defaultRaumfeldEntity;
                if (!browseEntity) { ws.close(); return; }
                ws.send(JSON.stringify({
                    id: 1, type: "media_player/browse_media",
                    entity_id: browseEntity,
                    media_content_type: "object.container.favoritesContainer",
                    media_content_id: "0/Favorites/MyFavorites[:sep:]0/Favorites/MyFavorites"
                }));
            } else if (msg.id === 1) {
                if (msg.success && msg.result && msg.result.children) {
                    self.radioFavorites = msg.result.children.map(function(item) {
                        return {
                            title: item.title,
                            content_type: item.media_content_type,
                            content_id: item.media_content_id
                        };
                    });
                    console.log("MMM-GestureControl: Loaded " + self.radioFavorites.length + " radio favorites");
                    // Try to find current station index
                    if (self.raumfeldMediaTitle) {
                        for (var i = 0; i < self.radioFavorites.length; i++) {
                            if (self.raumfeldMediaTitle.toLowerCase().indexOf(self.radioFavorites[i].title.toLowerCase()) >= 0 ||
                                self.radioFavorites[i].title.toLowerCase().indexOf("absolut") >= 0) {
                                // rough match
                            }
                        }
                    }
                }
                ws.close();
            }
        });
        ws.on("error", function(e) {
            console.error("MMM-GestureControl: WS favorites error: " + e.message);
        });
        } catch(e) { console.error("MMM-GestureControl: loadRadioFavorites exception: " + e.message); }
    },

    detectActiveMedia: function() {
        if (!this.haToken) return;
        var self = this;
        var spotifyPlaying = false;
        var raumfeldPlaying = false;
        var checked = 0;
        var entities = self.config.mediaEntities || [];
        if (entities.length === 0) return;
        entities.forEach(function(eid) {
            var req = http.request({
                hostname: self.config.haHost, port: self.config.haPort,
                path: "/api/states/" + eid, method: "GET",
                headers: {"Authorization": "Bearer " + self.haToken}
            }, function(res) {
                var body = "";
                res.on("data", function(c) { body += c; });
                res.on("end", function() {
                    try {
                        var data = JSON.parse(body);
                        var state = data.state;
                        var attrs = data.attributes || {};
                        if (eid === self.config.spotifyEntity && state === "playing") {
                            spotifyPlaying = true;
                            self.spotifyTitle = attrs.media_title || null;
                            self.spotifyArtist = attrs.media_artist || null;
                            self.spotifyPicture = attrs.entity_picture || null;
                            self.spotifyAlbum = attrs.media_album_name || null;
                        } else if (eid === self.config.spotifyEntity) {
                            self.spotifyTitle = null;
                            self.spotifyArtist = null;
                            self.spotifyPicture = null;
                            self.spotifyAlbum = null;
                        }
                        if (eid !== self.config.spotifyEntity && (state === "playing" || state === "paused")) {
                            raumfeldPlaying = true;
                            // Prefer groups over individual speakers
                            if (!self.raumfeldEntity || eid.indexOf("group") >= 0) {
                                self.raumfeldEntity = eid;
                                // Detect content type from media_duration
                                var dur = attrs.media_duration;
                                if (dur === 2147483647 || (dur === 0 && state === "playing")) {
                                    self.raumfeldContentType = "radio";
                                } else if (dur > 0 && dur < 86400) {
                                    self.raumfeldContentType = "track";
                                } else {
                                    self.raumfeldContentType = "unknown";
                                }
                                self.raumfeldMediaTitle = attrs.media_title || null;
                                self.raumfeldMediaAlbum = attrs.media_album_name || null;
                                self.raumfeldMediaArtist = attrs.media_artist || null;
                            }
                        }
                    } catch(e) {}
                    checked++;
                    if (checked === entities.length) {
                        var prev = self.autoMediaTarget;
                        if (spotifyPlaying && raumfeldPlaying) self.autoMediaTarget = "both";
                        else if (raumfeldPlaying) self.autoMediaTarget = "raumfeld";
                        else self.autoMediaTarget = "spotify";
                        if (self.autoMediaTarget !== prev)
                            console.log("MMM-GestureControl: Auto media -> " + self.autoMediaTarget + " raumfeld_entity=" + self.raumfeldEntity + " type=" + self.raumfeldContentType);
                        // Publish media status via MQTT
                        if (self.mqttClient) {
                            self.mqttClient.publish("mm/media/status", JSON.stringify({
                                target: self.autoMediaTarget,
                                raumfeld_entity: self.raumfeldEntity,
                                raumfeld_type: self.raumfeldContentType,
                                raumfeld_title: self.raumfeldMediaTitle,
                                raumfeld_album: self.raumfeldMediaAlbum,
                                raumfeld_artist: self.raumfeldMediaArtist,
                                spotify_playing: spotifyPlaying,
                                spotify_title: self.spotifyTitle || null,
                                spotify_artist: self.spotifyArtist || null,
                                spotify_picture: self.spotifyPicture || null,
                                spotify_album: self.spotifyAlbum || null,
                                raumfeld_playing: raumfeldPlaying
                            }));
                        }
                    }
                });
            });
            req.on("error", function() { checked++; });
            req.end();
        });
    },

    mediaControl: function(payload) {
        var action = payload.action;
        var token = payload.token;
        this.startAutoDetect(token);
        var target = payload.media_target || "spotify";
        if (target === "auto") target = this.autoMediaTarget;
        console.log("MMM-GestureControl: Media " + action + " target=" + target + " rfType=" + this.raumfeldContentType);

        if ((target === "spotify" || target === "both") && this.config.spotifyEntity) {
            this.callHAService(token, "media_player", action, {
                entity_id: this.config.spotifyEntity
            });
        }
        if (target === "raumfeld" || target === "both") {
            var rfEntity = this.raumfeldEntity || this.config.defaultRaumfeldEntity;
            if (!rfEntity) return;
            if (action === "media_play_pause") {
                // Play/pause always works directly
                this.callHAService(token, "media_player", action, {entity_id: rfEntity});
            } else if (action === "media_next_track" || action === "media_previous_track") {
                if (this.raumfeldContentType === "radio" && this.radioFavorites && this.radioFavorites.length > 0) {
                    // Radio: cycle through favorites
                    var dir = action === "media_next_track" ? 1 : -1;
                    this.radioFavIndex = ((this.radioFavIndex + dir) + this.radioFavorites.length) % this.radioFavorites.length;
                    var fav = this.radioFavorites[this.radioFavIndex];
                    console.log("MMM-GestureControl: Radio -> " + fav.title + " (idx=" + this.radioFavIndex + ")");
                    // Extract play URI from content_id (after [:sep:])
                    var playUri = fav.content_id;
                    if (playUri.indexOf("[:sep:]") >= 0) {
                        playUri = playUri.split("[:sep:]")[1];
                    }
                    this.callHAService(token, "media_player", "play_media", {
                        entity_id: rfEntity,
                        media_content_id: playUri,
                        media_content_type: fav.content_type
                    });
                } else {
                    // Track mode or unknown: use standard next/prev
                    this.callHAService(token, "media_player", action, {entity_id: rfEntity});
                }
            }
        }
    },

    callHA: function(token, entityId, rgbColor) {
        var data = JSON.stringify({
            entity_id: entityId,
            rgb_color: rgbColor
        });

        var req = http.request({
            hostname: this.config.haHost,
            port: this.config.haPort,
            path: "/api/services/light/turn_on",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token,
                "Content-Length": Buffer.byteLength(data)
            }
        }, function(res) {
            console.log("MMM-GestureControl: HA " + entityId + " -> " + res.statusCode);
        });

        req.on("error", function(e) {
            console.error("MMM-GestureControl: HA error " + entityId + " - " + e.message);
        });

        req.write(data);
        req.end();
    },

    handleDialAdjust: function(payload) {
        var type = payload.type;
        var dir = payload.direction;  // +1 or -1
        var lights = payload.lights;
        var token = payload.token;

        if (type === "brightness") {
            // brightness_step is a valid HA param (-255 to 255)
            var step = dir * this.config.brightnessStep;
            console.log("MMM-GestureControl: Dial brightness " + (dir > 0 ? "+" : "") + step);
            for (var i = 0; i < lights.length; i++) {
                this.callHAGeneric(token, lights[i], {
                    brightness_step: step
                });
            }
        } else if (type === "color_temp") {
            // color_temp_step doesn't exist in HA API — use absolute color_temp (mireds)
            // Track current value, range: 153 (cool) to 500 (warm)
            if (!this._currentMired) this._currentMired = 300;
            this._currentMired = Math.max(this.config.colorTempMin, Math.min(this.config.colorTempMax, this._currentMired + dir * this.config.colorTempStep));
            console.log("MMM-GestureControl: Dial color_temp -> " + this._currentMired + " mireds");
            for (var i = 0; i < lights.length; i++) {
                this.callHAGeneric(token, lights[i], {
                    color_temp: this._currentMired
                });
            }
        } else if (type === "hue") {
            // Cycle through hue (0-360 degrees), full saturation
            if (!this._currentHue) this._currentHue = 0;
            this._currentHue = (this._currentHue + dir * this.config.hueStep + 360) % 360;
            console.log("MMM-GestureControl: Dial hue -> " + this._currentHue);
            for (var i = 0; i < lights.length; i++) {
                this.callHAGeneric(token, lights[i], {
                    hs_color: [this._currentHue, 100]
                });
            }
        } else if (type === "volume") {
            console.log("MMM-GestureControl: Dial volume " + (dir > 0 ? "up" : "down"));
            this.callHAService(token, "media_player", dir > 0 ? "volume_up" : "volume_down", {});
        }
    },

    callHAGeneric: function(token, entityId, serviceData) {
        var data = JSON.stringify(Object.assign({entity_id: entityId}, serviceData));
        var req = http.request({
            hostname: this.config.haHost,
            port: this.config.haPort,
            path: "/api/services/light/turn_on",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token,
                "Content-Length": Buffer.byteLength(data)
            }
        }, function(res) {
            if (res.statusCode !== 200) {
                console.log("MMM-GestureControl: HA " + entityId + " -> " + res.statusCode);
            }
        });
        req.on("error", function(e) {
            console.error("MMM-GestureControl: HA error " + entityId + " - " + e.message);
        });
        req.write(data);
        req.end();
    },

    callHAService: function(token, domain, service, serviceData) {
        var data = JSON.stringify(serviceData);
        var req = http.request({
            hostname: this.config.haHost,
            port: this.config.haPort,
            path: "/api/services/" + domain + "/" + service,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token,
                "Content-Length": Buffer.byteLength(data)
            }
        }, function(res) {});
        req.on("error", function(e) {});
        req.write(data);
        req.end();
    },

    stop: function() {
        if (this._autoInterval) {
            clearInterval(this._autoInterval);
            this._autoInterval = null;
        }
        if (this._favoritesWs) {
            this._favoritesWs.close();
            this._favoritesWs = null;
        }
        if (this.mqttClient) {
            this.mqttClient.end();
            this.mqttClient = null;
        }
    }
});
